import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  applyContextualRoutingPriorities,
  applyExpectedFieldCatalogFallback,
  deterministicConversationRouting,
  mergeConversationRouting,
  normalizeConversationRouting
} from '../src/services/conversation-router.js'
import {
  businessInformationNeedsHuman,
  formatProfessionalWorkingHours,
  recoveryActionFromInteractiveReply,
  recoveryDecisionButtons
} from '../src/services/conversation-service.js'
import {
  renderCatalogServiceQuery,
  type BusinessKnowledge
} from '../src/services/business-knowledge-service.js'

const catalog = {
  services: [{ id: 'illumination', name: 'Iluminación', aliases: ['balayage'] }],
  professionals: [{ id: 'tamara', name: 'Tamara', aliases: ['Tami'] }]
}

const professionalSchedule = normalizeConversationRouting({
  intents: [{
    type: 'professional_schedule',
    topic: null,
    confidence: 0.97,
    evidence: 'qué horarios tiene tamara'
  }],
  bookingMessage: null,
  bookingExtraction: extraction({
    professional: field('tamara', 0.98, 'tamara')
  }),
  catalogQuery: null
})
const scheduleRouting = mergeConversationRouting(
  professionalSchedule,
  deterministicConversationRouting('¿Qué horarios tiene Tamara?', { currentStep: 'ASK_PROFESSIONAL', catalog }),
  '¿Qué horarios tiene Tamara?',
  catalog
)
assert.equal(scheduleRouting.intents[0]?.type, 'professional_schedule')
assert.equal(scheduleRouting.bookingMessage, null)
assert.equal(scheduleRouting.bookingExtraction?.professional.value, 'tamara')

const addressRouting = mergeConversationRouting(
  normalizeConversationRouting({
    intents: [{ type: 'business_information', topic: 'address', confidence: 0.96, evidence: 'sede cañitas' }],
    bookingMessage: null,
    bookingExtraction: null,
    catalogQuery: null
  }),
  deterministicConversationRouting('¿Es para sede Cañitas?', { currentStep: 'ASK_PROFESSIONAL', catalog }),
  '¿Es para sede Cañitas?',
  catalog
)
assert.equal(addressRouting.intents.some((intent) => intent.topic === 'address'), true)
assert.equal(addressRouting.bookingMessage, null)

const serviceSelection = mergeConversationRouting(
  normalizeConversationRouting({
    intents: [{ type: 'book_appointment', topic: null, confidence: 0.98, evidence: 'iluminación' }],
    bookingMessage: 'Iluminación',
    bookingExtraction: extraction({ service: field('illumination', 0.99, 'Iluminación') }),
    catalogQuery: null
  }),
  deterministicConversationRouting('Iluminación', { currentStep: 'ASK_SERVICE', catalog }),
  'Iluminación',
  catalog
)
assert.equal(serviceSelection.bookingMessage, 'Iluminación')
assert.equal(serviceSelection.bookingExtraction?.service.value, 'illumination')
assert.equal(serviceSelection.catalogQuery, null)

const correctedBareService = applyContextualRoutingPriorities({
  intents: [{ type: 'business_information', topic: 'services', confidence: 0.9, evidence: 'Iluminación' }],
  bookingMessage: null,
  bookingExtraction: extraction({ service: field('illumination', 0.98, 'Iluminación') }),
  catalogQuery: {
    serviceId: 'illumination',
    requestedInformation: ['general'],
    confidence: 0.9,
    evidence: 'Iluminación'
  }
}, { message: 'Iluminación', currentStep: 'ASK_SERVICE' })
assert.equal(correctedBareService.bookingMessage, 'Iluminación')
assert.equal(correctedBareService.catalogQuery, null)
assert.equal(correctedBareService.intents[0]?.type, 'book_appointment')

const correctedProfessional = applyContextualRoutingPriorities({
  intents: [{ type: 'unknown', topic: null, confidence: 0.2, evidence: 'tamra' }],
  bookingMessage: null,
  bookingExtraction: extraction({ professional: field('tamara', 0.91, 'tamra') }),
  catalogQuery: null
}, { message: 'tamra', currentStep: 'ASK_PROFESSIONAL' })
assert.equal(correctedProfessional.bookingMessage, 'tamra')
assert.equal(correctedProfessional.intents[0]?.type, 'professional_preference')

const groundedService = applyExpectedFieldCatalogFallback({
  intents: [{ type: 'go_back', topic: null, confidence: 1, evidence: 'Iluminación' }],
  bookingMessage: null,
  bookingExtraction: null,
  catalogQuery: null
}, { message: 'Iluminación', currentStep: 'ASK_SERVICE', catalog })
assert.equal(groundedService.bookingMessage, 'Iluminación')
assert.equal(groundedService.bookingExtraction?.service.value, 'illumination')
assert.equal(groundedService.intents[0]?.type, 'book_appointment')

const groundedTypo = applyExpectedFieldCatalogFallback({
  intents: [{ type: 'unknown', topic: null, confidence: 0, evidence: 'tamra' }],
  bookingMessage: null,
  bookingExtraction: null,
  catalogQuery: null
}, { message: 'tamra', currentStep: 'ASK_PROFESSIONAL', catalog })
assert.equal(groundedTypo.bookingExtraction?.professional.value, 'tamara')
assert.equal(groundedTypo.intents[0]?.type, 'professional_preference')

assert.equal(
  deterministicConversationRouting('¿Me agendás para esta semana?').bookingMessage,
  '¿Me agendás para esta semana?'
)

const otherQuery = normalizeConversationRouting({
  intents: [{ type: 'other_query', topic: null, confidence: 0.94, evidence: 'antes de seguir tengo otra duda' }],
  bookingMessage: null,
  bookingExtraction: null,
  catalogQuery: null
})
assert.equal(otherQuery.intents[0]?.type, 'other_query')

const serviceDetail = applyContextualRoutingPriorities(normalizeConversationRouting({
  intents: [{ type: 'service_detail', topic: null, confidence: 0.94, evidence: 'me lavan el cabello' }],
  bookingMessage: 'me lavan el cabello',
  bookingExtraction: null,
  catalogQuery: null
}), { message: '¿Me lavan el cabello en el lugar?', currentStep: 'ASK_SERVICE' })
assert.equal(serviceDetail.intents[0]?.type, 'service_detail')
assert.equal(serviceDetail.bookingMessage, null)

const buttons = recoveryDecisionButtons('conversation-1')
assert.equal(buttons.length, 3)
assert.ok(buttons.every((button) => button.title.length <= 20))
assert.equal(recoveryActionFromInteractiveReply(buttons[0]?.id, 'conversation-1'), 'resume')
assert.equal(recoveryActionFromInteractiveReply(buttons[1]?.id, 'conversation-1'), 'other_query')
assert.equal(recoveryActionFromInteractiveReply(buttons[2]?.id, 'conversation-1'), 'handoff')
assert.equal(recoveryActionFromInteractiveReply(buttons[2]?.id, 'conversation-2'), null)

assert.deepEqual(formatProfessionalWorkingHours([
  { dayOfWeek: 2, startTime: '10:00', endTime: '18:00' },
  { dayOfWeek: 4, startTime: '12:00', endTime: '20:00' }
]), [
  '• Martes: 10:00 a 18:00',
  '• Jueves: 12:00 a 20:00'
])

const business: BusinessKnowledge = {
  name: 'Glow',
  slug: 'glow',
  landingEnabled: true,
  publicWhatsapp: null,
  contactEmail: null,
  publicAddress: null,
  publicAddressArea: null,
  publicMapsUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  businessHours: [],
  services: [{
    id: 'illumination',
    name: 'Iluminación',
    description: 'Incluye diagnóstico, lavado y aplicación del producto.',
    duration: 90,
    price: 160000,
    priceMode: 'STARTING_AT'
  }],
  professionals: []
}
const processAnswer = renderCatalogServiceQuery(business, {
  serviceId: 'illumination',
  requestedInformation: ['general'],
  confidence: 0.96,
  evidence: 'me lavan el cabello en el lugar'
})
assert.match(processAnswer ?? '', /lavado y aplicación/)

const missingProcessAnswer = renderCatalogServiceQuery({
  ...business,
  services: [{ ...business.services[0]!, description: null }]
}, {
  serviceId: 'illumination',
  requestedInformation: ['general'],
  confidence: 0.96,
  evidence: 'cómo es el proceso'
})
assert.equal(businessInformationNeedsHuman(missingProcessAnswer ?? ''), true)

const serviceSource = await readFile(new URL('../src/services/conversation-service.ts', import.meta.url), 'utf8')
assert.match(serviceSource, /misunderstandingCount >= 3/)
assert.match(serviceSource, /recoveryDecisionButtons/)
assert.match(serviceSource, /professionalScheduleReply/)
const routerSource = await readFile(new URL('../src/services/conversation-router.ts', import.meta.url), 'utf8')
for (const phrase of ['qué horarios tiene Tamara', 'sede, sucursal, barrio', 'agenden o reserven esta semana']) {
  assert.equal(routerSource.includes(phrase), true, phrase)
}

console.log('conversation-recovery-contract-test: OK')

function field(value: string | null = null, confidence = 0, evidence = '') {
  return { value, confidence, evidence }
}

function extraction(overrides: Partial<ReturnType<typeof emptyExtraction>> = {}) {
  return { ...emptyExtraction(), ...overrides }
}

function emptyExtraction() {
  return {
    name: field(),
    service: field(),
    professional: field(),
    date: field(),
    time: field(),
    correction: { field: null, newValue: null, confidence: 0, evidence: '' }
  }
}
