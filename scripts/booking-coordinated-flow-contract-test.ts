import assert from 'node:assert/strict'
import { BookingV2Engine } from '../src/services/booking-v2-engine.js'
import { createBookingV2DomainCatalog } from '../src/services/booking-v2-domain.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'
import {
  acceptField,
  addCombinedServices,
  createEmptyBookingV2State
} from '../src/services/booking-v2-state.js'
import {
  bookingCoordinationMessageFromInteractiveReply,
  bookingCoordinationReplyButtons
} from '../src/services/conversation-service.js'
import type {
  BookingAvailabilitySearchOption,
  BookingAvailabilitySearchStatus
} from '../src/services/booking-availability-search.js'
import { detectBookingCoordinationChoice } from '../src/services/booking-coordination-choice.js'

const catalog = createBookingV2DomainCatalog({
  services: [
    { id: 'color', name: 'Color Completo', aliases: ['color'], duration: 90, price: 1, category: 'Color' },
    { id: 'corte', name: 'Corte Hombre', aliases: ['corte'], duration: 30, price: 1, category: 'Corte' }
  ],
  professionals: [
    { id: 'tamara', name: 'Tamara', serviceIds: ['color'] },
    { id: 'julian', name: 'Julián', serviceIds: ['corte'] },
    { id: 'lucas', name: 'Lucas', serviceIds: ['corte'] }
  ]
})

function option(startTime: string, endTime: string, cutter = 'julian'): BookingAvailabilitySearchOption {
  const colorEnd = startTime === '09:00'
    ? '10:30'
    : startTime === '12:00'
      ? '13:30'
      : startTime === '13:00'
        ? '14:30'
        : '16:30'
  return {
    id: `2026-08-10|${startTime}|${cutter}`,
    date: '2026-08-10',
    startTime,
    endTime,
    preferredProfessionalRespected: false,
    segments: [
      {
        serviceId: 'color',
        serviceName: 'Color Completo',
        professionalId: 'tamara',
        professionalName: 'Tamara',
        startTime,
        endTime: colorEnd
      },
      {
        serviceId: 'corte',
        serviceName: 'Corte Hombre',
        professionalId: cutter,
        professionalName: cutter === 'julian' ? 'Julián' : 'Lucas',
        startTime: colorEnd,
        endTime
      }
    ]
  }
}

const tomorrowOptions = [
  option('09:00', '11:00'),
  option('12:00', '14:00'),
  option('13:00', '15:00', 'lucas'),
  option('15:00', '17:00')
]
const searchCalls: Array<{ type: string; date?: string; requestedTime?: string | null }> = []
const domain = {
  async loadCatalog() { return catalog },
  toExtractionCatalog() {
    return {
      services: catalog.services.map((service) => ({
        id: service.id,
        name: service.name,
        aliases: service.aliases
      })),
      professionals: catalog.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name
      }))
    }
  },
  toInterpreterCatalog() {
    return {
      serviceIds: catalog.serviceIds,
      professionalIds: catalog.professionalIds,
      professionalServiceIds: catalog.professionalServiceIds
    }
  },
  async findAvailabilityOptions() {
    return { ok: true as const, options: [] }
  },
  async searchAvailability(input: {
    mode: { type: string; date?: string; requestedTime?: string | null; time?: string }
  }) {
    searchCalls.push({
      type: input.mode.type,
      ...(input.mode.date ? { date: input.mode.date } : {}),
      ...('requestedTime' in input.mode ? { requestedTime: input.mode.requestedTime } : {})
    })
    if (input.mode.type === 'NEXT_DAYS') {
      return searchResult('NEXT_DATES_FOUND', tomorrowOptions)
    }
    if (input.mode.type === 'TIME_ACROSS_DAYS') {
      return searchResult(
        input.mode.time === '12:00' ? 'NEXT_DATES_FOUND' : 'NO_UPCOMING_AVAILABILITY',
        input.mode.time === '12:00' ? [tomorrowOptions[1]!] : []
      )
    }
    const options = input.mode.date === '2026-08-10' ? tomorrowOptions : []
    const filtered = input.mode.requestedTime
      ? options.filter((option) => option.startTime === input.mode.requestedTime)
      : options
    return searchResult(
      filtered.length ? 'AVAILABLE' : options.length ? 'REQUESTED_TIME_UNAVAILABLE' : 'NO_AVAILABILITY_ON_DATE',
      filtered.length ? filtered : options
    )
  }
}

function searchResult(
  status: BookingAvailabilitySearchStatus,
  options: BookingAvailabilitySearchOption[]
) {
  return {
    status,
    options,
    searchedDates: ['2026-08-10'],
    requestedTime: null,
    individualAvailabilityFound: options.length > 0,
    errors: []
  }
}

const nullExtractor = { async extract() { return null } }
const unusedClassifier = { async classify() { return { decision: null, confidence: 0 } } }
const unusedDecision = { async extract() { return { decision: 'unclear' as const, confidence: 0 } } }
const unusedOption = { async extract() { return { optionId: null, confidence: 0 } } }
const unusedChoice = { async extract() { return { choiceId: null, confidence: 0 } } }
const engine = new BookingV2Engine(
  domain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  unusedChoice
)

let state = acceptField(createEmptyBookingV2State(), 'name', 'Matías')
state = acceptField(state, 'service', 'color')
state = addCombinedServices(state, [{ serviceId: 'corte', evidence: 'corte' }])
state = { ...state, pendingServiceSeparation: { reason: 'no_common_professional' } }

const decisionButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: { type: 'offer_separate_services', reason: 'no_common_professional' },
  state
})
assert.deepEqual(decisionButtons?.map((button) => button.title), [
  'Coordinar horarios',
  'Modificar servicios',
  'Solicitar atención'
])
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(decisionButtons?.[0]?.id, 'conversation-1'),
  'coordinar horarios'
)
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(decisionButtons?.[1]?.id, 'conversation-1'),
  'modificar servicios'
)

const modificationMenu = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(state),
  message: 'modificar servicios'
})
assert.equal(modificationMenu.plan.type, 'show_service_modification_menu')
const modificationButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: modificationMenu.plan,
  state: modificationMenu.state
})
assert.deepEqual(modificationButtons?.map((button) => button.title), [
  'Cambiar un servicio',
  'Quitar un servicio',
  'Empezar de nuevo'
])
const removeService = await engine.process({
  businessId: 'business-1',
  conversation: modificationMenu.conversationPatch,
  message: 'quitar un servicio'
})
assert.equal(removeService.plan.type, 'ask_service_edit_target')
if (removeService.plan.type !== 'ask_service_edit_target') throw new Error('Plan inesperado')
assert.equal(removeService.plan.action, 'remove')
const restartedBooking = await engine.process({
  businessId: 'business-1',
  conversation: modificationMenu.conversationPatch,
  message: 'empezar de nuevo desde cero'
})
assert.equal(restartedBooking.plan.type, 'ask_field')
assert.equal(restartedBooking.plan.type === 'ask_field' ? restartedBooking.plan.field : null, 'service')
assert.equal(restartedBooking.state.draft.name, 'Matías')

const started = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(state),
  message: 'coordinar horarios',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(started.plan.type, 'ask_coordinated_date')
assert.deepEqual(started.state.pendingCoordinatedAvailability?.quickDates, ['2026-08-10'])
const dateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: started.plan,
  state: started.state
})
assert.deepEqual(dateButtons?.map((button) => button.title), ['Mañana', 'Próximos días', 'Otra fecha'])
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(dateButtons?.[0]?.id, 'conversation-1'),
  '2026-08-10'
)

const startedByYes = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(state),
  message: 'sí',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(startedByYes.plan.type, 'ask_coordinated_date')
assert.equal(startedByYes.state.pendingServiceSeparation, null)

assert.deepEqual(detectBookingCoordinationChoice({
  message: 'a la 1',
  phase: 'TIME_PREFERENCE'
}), { type: 'EXACT_TIME', time: '13:00' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: '1300 a 1500',
  phase: 'TIME_PREFERENCE'
}), { type: 'TIME_WINDOW', startTime: '13:00', endTime: '15:00' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'mostrame todos los horarios',
  phase: 'OPTION'
}), { type: 'SHOW_MORE' })
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(dateButtons?.[0]?.id, 'otra-conversation'),
  null
)

const selectedTomorrow = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: 'mañana',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(selectedTomorrow.plan.type, 'ask_coordinated_time_preference')
if (selectedTomorrow.plan.type !== 'ask_coordinated_time_preference') throw new Error('Plan inesperado')
assert.deepEqual(selectedTomorrow.plan.bands, ['MORNING', 'MIDDAY', 'AFTERNOON'])
const bandButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: selectedTomorrow.plan,
  state: selectedTomorrow.state
})
assert.deepEqual(bandButtons?.map((button) => button.title), [
  'Por la mañana',
  'Al mediodía',
  'Por la tarde'
])

const unavailableToday = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: 'hoy',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(unavailableToday.plan.type, 'coordinated_date_unavailable')
const unavailableButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: unavailableToday.plan,
  state: unavailableToday.state
})
assert.deepEqual(unavailableButtons?.map((button) => button.title), [
  'Próximos días',
  'Buscar un horario',
  'Más opciones'
])

const askTime = await engine.process({
  businessId: 'business-1',
  conversation: unavailableToday.conversationPatch,
  message: 'buscar un horario'
})
assert.equal(askTime.plan.type, 'ask_coordinated_search_time')
const datesAtNoon = await engine.process({
  businessId: 'business-1',
  conversation: askTime.conversationPatch,
  message: 'a las 12',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(datesAtNoon.plan.type, 'ask_coordinated_date')
assert.deepEqual(datesAtNoon.state.pendingCoordinatedAvailability?.quickDates, ['2026-08-10'])

const moreActions = await engine.process({
  businessId: 'business-1',
  conversation: unavailableToday.conversationPatch,
  message: 'más opciones'
})
assert.equal(moreActions.plan.type, 'show_coordinated_more_options')
const moreButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: moreActions.plan,
  state: moreActions.state
})
assert.deepEqual(moreButtons?.map((button) => button.title), [
  'Elegir otra fecha',
  'Modificar servicios',
  'Solicitar atención'
])

const midday = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: 'al mediodía'
})
assert.equal(midday.plan.type, 'offer_coordinated_options')
if (midday.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(midday.plan.options.map((item) => item.startTime), ['12:00', '13:00'])
const optionButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: midday.plan,
  state: midday.state
})
assert.deepEqual(optionButtons?.map((button) => button.title), ['12:00', '13:00', 'Ver más horarios'])

const semanticEngine = new BookingV2Engine(
  domain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  {
    async extract() {
      return { choiceId: 'midday', confidence: 0.96 }
    }
  }
)
const semanticMidday = await semanticEngine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: 'más bien cuando el día está por la mitad'
})
assert.equal(semanticMidday.plan.type, 'offer_coordinated_options')
if (semanticMidday.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(semanticMidday.plan.options.map((item) => item.startTime), ['12:00', '13:00'])

const exactTime = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: 'a las 12'
})
assert.equal(exactTime.plan.type, 'offer_coordinated_options')
if (exactTime.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(exactTime.plan.options.map((item) => item.startTime), ['12:00'])

const window = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: 'de 1 a 3'
})
assert.equal(window.plan.type, 'offer_coordinated_options')
if (window.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(window.plan.options.map((item) => `${item.startTime}-${item.endTime}`), ['13:00-15:00'])

const chosen = await engine.process({
  businessId: 'business-1',
  conversation: midday.conversationPatch,
  message: '1'
})
assert.equal(chosen.plan.type, 'show_coordinated_selection')
assert.equal(chosen.state.pendingCoordinatedAvailability?.selectedOptionId, tomorrowOptions[1]?.id)

const restored = stateFromConversation(conversationPatchFromState(midday.state))
assert.deepEqual(restored.pendingCoordinatedAvailability, midday.state.pendingCoordinatedAvailability)
assert.equal(searchCalls.some((call) => call.type === 'DATE' && call.date === '2026-08-10'), true)

console.log('booking-coordinated-flow-contract-test: OK')
