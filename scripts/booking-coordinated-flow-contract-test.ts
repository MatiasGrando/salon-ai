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
  bookingCoordinationReplyButtons,
  isUnambiguousBookingConfirmation,
  shouldPrioritizeCoordinatedAvailabilityAction,
  shouldHandleProfessionalScheduleInformation
} from '../src/services/conversation-service.js'
import type {
  BookingAvailabilitySearchOption,
  BookingAvailabilitySearchStatus
} from '../src/services/booking-availability-search.js'
import {
  bookingCoordinationActionableReply,
  detectBookingCoordinationChoice
} from '../src/services/booking-coordination-choice.js'
import { detectDeterministicConfirmation } from '../src/services/conversation-confirmation-intent.js'
import { BookingV2EstimateDecisionExtractor } from '../src/services/booking-v2-estimate-decision-extractor.js'
import { renderBookingV2Response } from '../src/services/booking-v2-response-renderer.js'
import {
  buildWhatsAppInteractiveListPayload,
  buildWhatsAppReplyButtonsPayload
} from '../src/integrations/whatsapp-cloud-api.js'
import { WhatsAppWebhookService } from '../src/services/whatsapp-webhook-service.js'

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

function timeAfter(startTime: string, minutes: number) {
  const [hours = 0, mins = 0] = startTime.split(':').map(Number)
  const total = hours * 60 + mins + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function datedOption(
  date: string,
  startTime: string,
  cutter = 'julian',
  suffix = ''
): BookingAvailabilitySearchOption {
  const colorEnd = timeAfter(startTime, 90)
  const endTime = timeAfter(startTime, 120)
  return {
    id: `${date}|${startTime}|${cutter}${suffix}`,
    date,
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
const searchCalls: Array<{
  type: string
  date?: string
  requestedTime?: string | null
  professionalId?: string | null
}> = []
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
    professionalId?: string | null
  }) {
    searchCalls.push({
      type: input.mode.type,
      ...(input.mode.date ? { date: input.mode.date } : {}),
      ...('requestedTime' in input.mode ? { requestedTime: input.mode.requestedTime } : {}),
      ...(input.professionalId !== undefined ? { professionalId: input.professionalId } : {})
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
const decisionReply = renderBookingV2Response({
  plan: { type: 'offer_separate_services', reason: 'no_common_professional' },
  draft: state.draft
})
assert.match(decisionReply, /• Coordinar horarios/)
assert.match(decisionReply, /• Modificar servicios/)
assert.match(decisionReply, /• Solicitar atención/)
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
const quotedRemoveService = await engine.process({
  businessId: 'business-1',
  conversation: modificationMenu.conversationPatch,
  message: `${modificationMenu.reply}\nQuitar un servicio`
})
assert.equal(quotedRemoveService.plan.type, 'ask_service_edit_target')
if (quotedRemoveService.plan.type !== 'ask_service_edit_target') throw new Error('Plan inesperado')
assert.equal(quotedRemoveService.plan.action, 'remove')
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
assert.equal(Boolean(dateButtons?.[0]?.title), true)
assert.deepEqual(dateButtons?.slice(1).map((button) => button.title), ['Ver días disponibles', 'Otra fecha'])
assert.match(started.reply, /En estos días puedo coordinar todos los servicios/)
assert.match(started.reply, /• Lunes 10\/08\/2026/)
assert.match(started.reply, /“mañana”, “el viernes” o “20\/8”/)
const selectedWrittenDate = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: 'Sábado 29/08/2026',
  currentDate: new Date('2026-08-21T17:22:00-03:00')
})
assert.equal(selectedWrittenDate.state.pendingCoordinatedAvailability?.date, '2026-08-29')
assert.deepEqual(searchCalls.at(-1), {
  type: 'DATE',
  date: '2026-08-29',
  requestedTime: null,
  professionalId: null
})
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(dateButtons?.[0]?.id, 'conversation-1'),
  '2026-08-10'
)
const whatsappDatePayload = buildWhatsAppReplyButtonsPayload({
  to: '5491112345678',
  text: started.reply,
  buttons: dateButtons ?? []
})
const whatsappDateButton = whatsappDatePayload.interactive.action.buttons[0]?.reply
assert.ok(whatsappDateButton)
const incomingDateButton = new WhatsAppWebhookService().extractIncomingMessages({
  entry: [{
    changes: [{
      value: {
        messages: [{
          id: 'wamid.coordinated-date',
          from: '5491112345678',
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: whatsappDateButton
          }
        }]
      }
    }]
  }]
})[0]
const canonicalDateButtonMessage = bookingCoordinationMessageFromInteractiveReply(
  incomingDateButton?.interactiveReplyId,
  'conversation-1'
)
assert.equal(canonicalDateButtonMessage, '2026-08-10')
const selectedDateFromWhatsAppButton = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: canonicalDateButtonMessage ?? '',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(selectedDateFromWhatsAppButton.state.pendingCoordinatedAvailability?.date, '2026-08-10')
assert.deepEqual(searchCalls.at(-1), {
  type: 'DATE',
  date: '2026-08-10',
  requestedTime: null,
  professionalId: null
})
assert.equal(selectedDateFromWhatsAppButton.plan.type, 'ask_coordinated_time_preference')
const exactTimePrompt = await engine.process({
  businessId: 'business-1',
  conversation: selectedDateFromWhatsAppButton.conversationPatch,
  message: 'Horario exacto',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(exactTimePrompt.plan.type, 'ask_coordinated_search_time')
assert.equal(exactTimePrompt.state.pendingCoordinatedAvailability?.phase, 'AWAITING_SEARCH_TIME')
assert.match(exactTimePrompt.reply, /Escribí una hora, por ejemplo “16:30”/)
assert.doesNotMatch(exactTimePrompt.reply, /rango/)
const selectedRangeAfterExactTime = await engine.process({
  businessId: 'business-1',
  conversation: exactTimePrompt.conversationPatch,
  message: 'de 13 a 15',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(selectedRangeAfterExactTime.plan.type, 'offer_coordinated_options')
assert.deepEqual(
  selectedRangeAfterExactTime.state.pendingCoordinatedAvailability?.requestedWindow,
  { startTime: '13:00', endTime: '15:00' }
)
assert.deepEqual(
  selectedRangeAfterExactTime.state.pendingCoordinatedAvailability?.filteredOptionIds,
  [option('13:00', '15:00', 'lucas').id]
)
assert.equal(shouldHandleProfessionalScheduleInformation({
  hasProfessionalScheduleIntent: true,
  hasPendingCoordinatedAvailability: true,
  isPendingDeterministicDecision: false,
  hasProfessionalId: false,
  informationTopicCount: 0
}), false)
const selectedTodayWithoutScheduleInterruption = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: 'hoy',
  currentDate: new Date('2026-08-10T00:21:00-03:00')
})
assert.equal(selectedTodayWithoutScheduleInterruption.plan.type, 'ask_coordinated_time_preference')

const startedByYes = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(state),
  message: 'sí',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(startedByYes.plan.type, 'ask_coordinated_date')
assert.equal(startedByYes.state.pendingServiceSeparation, null)

let requestedProfessionalState = acceptField(createEmptyBookingV2State(), 'name', 'Matías')
requestedProfessionalState = acceptField(requestedProfessionalState, 'service', 'color')
requestedProfessionalState = addCombinedServices(requestedProfessionalState, [{ serviceId: 'corte', evidence: 'corte' }])
requestedProfessionalState = acceptField(requestedProfessionalState, 'professional', 'tamara')
const upfrontProfessionalResolution = await engine.resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(requestedProfessionalState)
})
assert.equal(upfrontProfessionalResolution.plan.type, 'offer_separate_services')
assert.equal(upfrontProfessionalResolution.state.draft.professional, 'tamara')
const startedWithTamara = await engine.process({
  businessId: 'business-1',
  conversation: upfrontProfessionalResolution.conversationPatch,
  message: 'coordinar horarios',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(startedWithTamara.state.pendingCoordinatedAvailability?.requestedProfessionalId, 'tamara')
assert.equal(startedWithTamara.state.pendingCoordinatedAvailability?.requireRequestedProfessional, true)
assert.equal(searchCalls.some((call) => call.professionalId === 'tamara'), true)
const unavailableWithTamara = await engine.process({
  businessId: 'business-1',
  conversation: startedWithTamara.conversationPatch,
  message: 'hoy',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
const unavailableWithTamaraButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: unavailableWithTamara.plan,
  state: unavailableWithTamara.state
})
assert.deepEqual(unavailableWithTamaraButtons?.map((button) => button.title), [
  'Buscar otro día',
  'Buscar sin Tamara',
  'Solicitar atención'
])
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(
    unavailableWithTamaraButtons?.[1]?.id,
    'conversation-1'
  ),
  'buscar sin el profesional solicitado'
)
const relaxedProfessional = await engine.process({
  businessId: 'business-1',
  conversation: unavailableWithTamara.conversationPatch,
  message: 'buscar sin Tamara',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(relaxedProfessional.state.pendingCoordinatedAvailability?.requireRequestedProfessional, false)
assert.equal(relaxedProfessional.state.draft.professional, '__any_professional__')
const quotedRelaxedProfessional = await engine.process({
  businessId: 'business-1',
  conversation: unavailableWithTamara.conversationPatch,
  message: `${unavailableWithTamara.reply}\nBuscar sin Tamara`,
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(
  quotedRelaxedProfessional.state.pendingCoordinatedAvailability?.requireRequestedProfessional,
  false
)

assert.deepEqual(detectBookingCoordinationChoice({
  message: 'a la 1',
  phase: 'TIME_PREFERENCE'
}), { type: 'EXACT_TIME', time: '13:00' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: '1300 a 1500',
  phase: 'TIME_PREFERENCE'
}), { type: 'TIME_WINDOW', startTime: '13:00', endTime: '15:00' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'tenés algo después de las 18?',
  phase: 'TIME_PREFERENCE'
}), { type: 'AFTER_TIME', time: '18:00', inclusive: false })
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'desde las 18hs',
  phase: 'TIME_PREFERENCE'
}), { type: 'AFTER_TIME', time: '18:00', inclusive: true })
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'entre las 18 y las 20',
  phase: 'TIME_PREFERENCE'
}), { type: 'TIME_WINDOW', startTime: '18:00', endTime: '20:00' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'mostrame todos los horarios',
  phase: 'OPTION'
}), { type: 'SHOW_MORE' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: '16',
  phase: 'OPTION'
}), { type: 'EXACT_TIME', time: '16:00' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: '16',
  phase: 'TIME_PREFERENCE'
}), { type: 'EXACT_TIME', time: '16:00' })
for (const message of ['18h', '18hs', '18 hs', '18 hrs', '18 horas', '18:30 hs', 'sí, dale 18hs']) {
  assert.deepEqual(detectBookingCoordinationChoice({
    message,
    phase: 'OPTION'
  }), {
    type: 'EXACT_TIME',
    time: message === '18:30 hs' ? '18:30' : '18:00'
  })
}
assert.deepEqual(detectBookingCoordinationChoice({
  message: '16. 30',
  phase: 'TIME_PREFERENCE'
}), { type: 'EXACT_TIME', time: '16:30' })
assert.deepEqual(detectBookingCoordinationChoice({
  message: '16 30',
  phase: 'TIME_PREFERENCE'
}), { type: 'EXACT_TIME', time: '16:30' })
assert.equal(detectBookingCoordinationChoice({
  message: 'Sábado 29/08/2026',
  phase: 'TIME_PREFERENCE'
}), null)
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'Sábado 29/08/2026 a las 15:30',
  phase: 'TIME_PREFERENCE'
}), { type: 'EXACT_TIME', time: '15:30' })
for (const message of ['cambiar fecha', 'cambiar de día', 'volver a elegir fecha', 'prefiero otra fecha']) {
  assert.deepEqual(detectBookingCoordinationChoice({
    message,
    phase: 'TIME_PREFERENCE'
  }), { type: 'CHOOSE_OTHER_DATE' }, message)
}
assert.deepEqual(detectBookingCoordinationChoice({
  message: 'opción 16',
  phase: 'OPTION'
}), { type: 'OPTION', index: 15 })
assert.equal(shouldPrioritizeCoordinatedAvailabilityAction(
  'ver todos los horarios',
  'AWAITING_SEARCH_MENU'
), true)
assert.equal(shouldPrioritizeCoordinatedAvailabilityAction(
  'ver todos',
  'AWAITING_SEARCH_MENU'
), true)
assert.equal(shouldPrioritizeCoordinatedAvailabilityAction(
  '¿Cómo querés seguir buscando?\nVer todos los horarios del día\nPróximos días\nBuscar una hora específica\nVer todos los horarios',
  'AWAITING_SEARCH_MENU'
), true)
assert.equal(shouldPrioritizeCoordinatedAvailabilityAction(
  'quiero ver todos los horarios del local',
  'AWAITING_SEARCH_MENU'
), false)
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

const quotedPrompt = [
  'Perfecto  Voy a coordinar los servicios con profesionales distintos, en horarios consecutivos, para que puedas hacer todo en una sola visita.',
  '',
  '¿Qué día te gustaría venir?'
].join('\n')
const quotedNextDays = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: `${quotedPrompt}\nPróximos días`,
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(quotedNextDays.plan.type, 'ask_coordinated_date')
assert.deepEqual(quotedNextDays.state.pendingCoordinatedAvailability?.quickDates, ['2026-08-10'])
const quotedTomorrow = await engine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: `${quotedPrompt}\nMañana`,
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(quotedTomorrow.plan.type, 'ask_coordinated_time_preference')

const quotedMidday = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: `${selectedTomorrow.reply}\nAl mediodía`
})
assert.equal(quotedMidday.plan.type, 'offer_coordinated_options')
const quotedAfternoon = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: `${selectedTomorrow.reply}\nPor la tarde`
})
assert.equal(quotedAfternoon.plan.type, 'offer_coordinated_options')
if (quotedAfternoon.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(quotedAfternoon.plan.options.map((item) => item.startTime), ['15:00'])
const afterNoon = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: '¿Tenés algo después de las 12?'
})
assert.equal(afterNoon.plan.type, 'offer_coordinated_options')
if (afterNoon.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(afterNoon.plan.options.map((item) => item.startTime), ['13:00', '15:00'])
const selectedAfterNoon = await engine.process({
  businessId: 'business-1',
  conversation: afterNoon.conversationPatch,
  message: '15hs'
})
assert.equal(selectedAfterNoon.plan.type, 'show_coordinated_selection')
if (selectedAfterNoon.plan.type !== 'show_coordinated_selection') throw new Error('Plan inesperado')
assert.equal(selectedAfterNoon.plan.option.startTime, '15:00')
const quotedExactTimeButton = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: `${selectedTomorrow.reply}\nHorario exacto`
})
assert.equal(quotedExactTimeButton.plan.type, 'ask_coordinated_search_time')
const bandButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: selectedTomorrow.plan,
  state: selectedTomorrow.state
})
assert.deepEqual(bandButtons?.map((button) => button.title), [
  'Por la mañana',
  'Al mediodía',
  'Por la tarde',
  'Horario exacto',
  'Cambiar fecha'
])
const canonicalMorningButtonMessage = bookingCoordinationMessageFromInteractiveReply(
  bandButtons?.[0]?.id,
  'conversation-1'
)
assert.equal(canonicalMorningButtonMessage, 'por la mañana')
const selectedMorningFromWhatsAppButton = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: canonicalMorningButtonMessage ?? '',
  currentDate: new Date('2026-08-06T15:00:00-03:00')
})
assert.equal(selectedMorningFromWhatsAppButton.plan.type, 'offer_coordinated_options')
if (selectedMorningFromWhatsAppButton.plan.type !== 'offer_coordinated_options') {
  throw new Error('Plan inesperado')
}
assert.deepEqual(selectedMorningFromWhatsAppButton.plan.options.map((item) => item.startTime), ['09:00'])
assert.equal(selectedMorningFromWhatsAppButton.state.pendingCoordinatedAvailability?.date, '2026-08-10')
const changedDirectlyToToday = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: '¿Hoy no tenés nada?',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(changedDirectlyToToday.plan.type, 'coordinated_date_unavailable')
assert.equal(changedDirectlyToToday.state.pendingCoordinatedAvailability?.date, '2026-08-09')
assert.equal(searchCalls.at(-1)?.date, '2026-08-09')
const changeDateFromList = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: bookingCoordinationMessageFromInteractiveReply(
    bandButtons?.[4]?.id,
    'conversation-1'
  ) ?? ''
})
assert.equal(changeDateFromList.plan.type, 'ask_coordinated_date')
assert.equal(changeDateFromList.state.pendingCoordinatedAvailability?.phase, 'AWAITING_DATE')
assert.equal(changeDateFromList.state.draft.date, null)
const canonicalAfternoonButtonMessage = bookingCoordinationMessageFromInteractiveReply(
  bandButtons?.[2]?.id,
  'conversation-1'
)
assert.equal(canonicalAfternoonButtonMessage, 'por la tarde')
const selectedAfternoonFromWhatsAppButton = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: canonicalAfternoonButtonMessage ?? ''
})
assert.equal(selectedAfternoonFromWhatsAppButton.plan.type, 'offer_coordinated_options')
if (selectedAfternoonFromWhatsAppButton.plan.type !== 'offer_coordinated_options') {
  throw new Error('Plan inesperado')
}
assert.deepEqual(selectedAfternoonFromWhatsAppButton.plan.options.map((item) => item.startTime), ['15:00'])
const twoBandButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'ask_coordinated_time_preference',
    date: '2026-08-10',
    bands: ['MORNING', 'AFTERNOON']
  },
  state: selectedTomorrow.state
})
assert.deepEqual(twoBandButtons?.map((button) => button.title), [
  'Por la mañana',
  'Por la tarde',
  'Horario exacto',
  'Cambiar fecha'
])
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(twoBandButtons?.[2]?.id, 'conversation-1'),
  'buscar un horario'
)

const fiveDateReply = renderBookingV2Response({
  plan: {
    type: 'ask_coordinated_date',
    quickDates: ['2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15', '2026-08-17'],
    professionalName: 'Tamara',
    assignmentMode: 'MULTIPLE_PROFESSIONALS'
  },
  draft: selectedTomorrow.state.draft
})
assert.equal((fiveDateReply.match(/^• /gm) ?? []).length, 5)
assert.match(fiveDateReply, /manteniendo a Tamara/)
assert.match(fiveDateReply, /• Lunes 10\/08\/2026/)
const fiveDateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'ask_coordinated_date',
    quickDates: ['2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15', '2026-08-17'],
    professionalName: 'Tamara',
    assignmentMode: 'SINGLE_PROFESSIONAL'
  },
  state: selectedTomorrow.state
})
assert.equal(fiveDateButtons?.length, 6)
assert.equal(fiveDateButtons?.at(-1)?.id, 'coord:conversation-1:other_date')
const chooseAnotherDate = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: 'cambiar fecha',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(chooseAnotherDate.plan.type, 'ask_coordinated_date')
assert.deepEqual(chooseAnotherDate.plan.type === 'ask_coordinated_date' ? chooseAnotherDate.plan.quickDates : null, [])
assert.match(chooseAnotherDate.reply, /“mañana”, “el viernes” o “20\/8”/)
const chooseAnotherDateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: chooseAnotherDate.plan,
  state: chooseAnotherDate.state
})
assert.deepEqual(chooseAnotherDateButtons?.map((button) => button.title), [
  'Ver días disponibles',
  'Otra fecha'
])
assert.equal(chooseAnotherDateButtons?.some((button) => button.title.startsWith('Buscar sin')), false)
const requestedProfessionalDatePrompt = renderBookingV2Response({
  plan: {
    type: 'ask_coordinated_date',
    quickDates: [],
    professionalName: 'Tamara',
    assignmentMode: 'SINGLE_PROFESSIONAL'
  },
  draft: requestedProfessionalState.draft,
  catalog
})
assert.match(requestedProfessionalDatePrompt, /Mantenemos Color Completo con Tamara/)
assert.match(requestedProfessionalDatePrompt, /“mañana”, “el viernes” o “20\/8”/)

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
const quotedMoreActions = await engine.process({
  businessId: 'business-1',
  conversation: unavailableToday.conversationPatch,
  message: `${unavailableToday.reply}\nMás opciones`
})
assert.equal(quotedMoreActions.plan.type, 'show_coordinated_more_options')
const quotedHuman = await engine.process({
  businessId: 'business-1',
  conversation: unavailableToday.conversationPatch,
  message: `${unavailableToday.reply}\nSolicitar atención`
})
assert.equal(quotedHuman.plan.type, 'handoff')
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
assert.deepEqual(optionButtons?.map((button) => button.title), ['12:00', '13:00', 'Otras búsquedas'])
const repeatedTimeButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'offer_coordinated_options',
    date: '2026-08-10',
    options: [option('15:00', '17:00'), option('15:00', '17:00', 'lucas')],
    hasMore: false,
    page: 0,
    assignmentMode: 'MULTIPLE_PROFESSIONALS'
  },
  state: selectedTomorrow.state
})
assert.deepEqual(repeatedTimeButtons?.map((button) => button.title), [
  '1. 15:00',
  '2. 15:00',
  'Otras búsquedas'
])
const defensiveDuplicatePayload = buildWhatsAppReplyButtonsPayload({
  to: '5491112345678',
  text: 'Elegí una opción',
  buttons: [
    { id: 'one', title: '15:00' },
    { id: 'two', title: '15:00' }
  ]
})
assert.deepEqual(
  defensiveDuplicatePayload.interactive.action.buttons.map((button) => button.reply.title),
  ['1. 15:00', '2. 15:00']
)

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

const semanticNextDaysEngine = new BookingV2Engine(
  domain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  {
    async extract() {
      return { choiceId: 'next_days', confidence: 0.96 }
    }
  }
)
const semanticNextDays = await semanticNextDaysEngine.process({
  businessId: 'business-1',
  conversation: started.conversationPatch,
  message: 'veamos cuándo aparece algo más adelante',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(semanticNextDays.plan.type, 'ask_coordinated_date')

const exactTime = await engine.process({
  businessId: 'business-1',
  conversation: selectedTomorrow.conversationPatch,
  message: 'a las 12'
})
assert.equal(exactTime.plan.type, 'show_coordinated_selection')
if (exactTime.plan.type !== 'show_coordinated_selection') throw new Error('Plan inesperado')
assert.equal(exactTime.plan.option.startTime, '12:00')

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
assert.match(chosen.reply, /¿Confirmás estas dos reservas\?/)
const selectionButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: chosen.plan,
  state: chosen.state
})
assert.deepEqual(selectionButtons?.map((button) => button.title), [
  'Confirmar reservas',
  'Cambiar horario',
  'Solicitar atención'
])
assert.equal(
  bookingCoordinationActionableReply(`${chosen.reply}\nDale`),
  'Dale'
)
assert.equal(isUnambiguousBookingConfirmation('Dale'), true)
const quotedChosenTime = await engine.process({
  businessId: 'business-1',
  conversation: midday.conversationPatch,
  message: `${midday.reply}\n13:00`
})
assert.equal(quotedChosenTime.plan.type, 'show_coordinated_selection')
assert.equal(quotedChosenTime.state.pendingCoordinatedAvailability?.selectedOptionId, tomorrowOptions[2]?.id)
const quotedShowMore = await engine.process({
  businessId: 'business-1',
  conversation: midday.conversationPatch,
  message: `${midday.reply}\nVer más horarios`
})
assert.equal(quotedShowMore.plan.type, 'offer_coordinated_options')

const denseOptions = [
  datedOption('2026-08-10', '08:00'),
  datedOption('2026-08-10', '09:00'),
  datedOption('2026-08-10', '10:00'),
  datedOption('2026-08-10', '12:00'),
  datedOption('2026-08-10', '12:30'),
  datedOption('2026-08-10', '13:00'),
  datedOption('2026-08-10', '13:00', 'lucas', '-duplicate-professional'),
  datedOption('2026-08-10', '13:30'),
  datedOption('2026-08-10', '14:00'),
  datedOption('2026-08-10', '14:30'),
  datedOption('2026-08-10', '15:00'),
  datedOption('2026-08-10', '16:00')
]
const densePending = selectedTomorrow.state.pendingCoordinatedAvailability
if (!densePending) throw new Error('Falta disponibilidad coordinada para la prueba densa')
const denseState = {
  ...selectedTomorrow.state,
  pendingCoordinatedAvailability: {
    ...densePending,
    phase: 'AWAITING_TIME_PREFERENCE' as const,
    date: '2026-08-10',
    options: denseOptions,
    filteredOptionIds: denseOptions.map((item) => item.id),
    page: 0,
    timeBand: null,
    requestedTime: null,
    requestedWindow: null,
    selectedOptionId: null
  }
}
const denseExactTime = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(denseState),
  message: '16'
})
assert.equal(denseExactTime.plan.type, 'show_coordinated_selection')
if (denseExactTime.plan.type !== 'show_coordinated_selection') throw new Error('Plan inesperado')
assert.equal(denseExactTime.plan.option.startTime, '16:00')
assert.doesNotMatch(denseExactTime.reply, /Estas son las opciones/)

const denseNearbyTimes = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(denseState),
  message: '15:30'
})
assert.equal(denseNearbyTimes.plan.type, 'offer_coordinated_options')
if (denseNearbyTimes.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(
  denseNearbyTimes.plan.options.slice(0, 3).map((item) => item.startTime),
  ['15:00', '16:00', '14:30']
)
assert.match(denseNearbyTimes.reply, /alternativas más cercanas/)
assert.doesNotMatch(denseNearbyTimes.reply, /08:00 a/)

const lateOptions = ['17:30', '18:00', '18:30', '19:00'].map((time) =>
  datedOption('2026-08-10', time)
)
const lateState = {
  ...denseState,
  pendingCoordinatedAvailability: {
    ...denseState.pendingCoordinatedAvailability,
    options: lateOptions,
    filteredOptionIds: lateOptions.map((item) => item.id)
  }
}
const lateExactTimePrompt = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(lateState),
  message: 'Horario exacto'
})
assert.equal(lateExactTimePrompt.state.pendingCoordinatedAvailability?.phase, 'AWAITING_SEARCH_TIME')
const lateNearbyTimes = await engine.process({
  businessId: 'business-1',
  conversation: lateExactTimePrompt.conversationPatch,
  message: '18:15'
})
assert.equal(lateNearbyTimes.plan.type, 'offer_coordinated_options')
if (lateNearbyTimes.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(
  lateNearbyTimes.plan.options.map((item) => item.startTime),
  ['18:00', '18:30', '17:30', '19:00']
)
assert.match(lateNearbyTimes.reply, /No encontré una opción que comience exactamente a las 18:15/)
assert.match(lateNearbyTimes.reply, /alternativas más cercanas/)

const requestedProfessionalLateState = {
  ...lateState,
  draft: {
    ...lateState.draft,
    professional: 'tamara'
  },
  pendingCoordinatedAvailability: {
    ...lateState.pendingCoordinatedAvailability,
    requestedProfessionalId: 'tamara',
    requireRequestedProfessional: true
  }
}
const requestedProfessionalTimePrompt = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(requestedProfessionalLateState),
  message: 'Horario exacto'
})
const requestedProfessionalNearbyTimes = await engine.process({
  businessId: 'business-1',
  conversation: requestedProfessionalTimePrompt.conversationPatch,
  message: '18:15'
})
const contextualSearchMenu = await engine.process({
  businessId: 'business-1',
  conversation: requestedProfessionalNearbyTimes.conversationPatch,
  message: 'otras búsquedas'
})
assert.equal(contextualSearchMenu.plan.type, 'show_coordinated_search_menu')
assert.match(contextualSearchMenu.reply, /Mantener a Tamara y ver todos los horarios/)
assert.match(contextualSearchMenu.reply, /Elegir una hora y ver en qué próximos días Tamara está disponible/)
const contextualSearchMenuButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: contextualSearchMenu.plan,
  state: contextualSearchMenu.state
})
assert.deepEqual(contextualSearchMenuButtons?.map((button) => button.title), [
  'Todos los horarios',
  'Otros días con Tamara',
  'Hora en próximos días',
  '18:15 con otra persona'
])
assert.deepEqual(contextualSearchMenuButtons?.map((button) => button.description), [
  'Ver todos los horarios de Tamara del 10/08.',
  'Buscar cualquier horario de Tamara en próximas fechas.',
  'Indicá una hora y mirá qué días Tamara está disponible.',
  'Mantener las 18:15 y buscar otro profesional el 10/08.'
])
assert.equal(
  bookingCoordinationMessageFromInteractiveReply(contextualSearchMenuButtons?.[3]?.id, 'conversation-1'),
  'buscar sin el profesional solicitado'
)

const denseMidday = await engine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(denseState),
  message: 'al mediodía'
})
assert.equal(denseMidday.plan.type, 'offer_coordinated_options')
if (denseMidday.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.deepEqual(
  denseMidday.plan.options.map((item) => item.startTime),
  ['12:00', '12:30', '13:00', '13:30', '14:00']
)
assert.equal(new Set(denseMidday.plan.options.map((item) => `${item.startTime}-${item.endTime}`)).size, 5)

const denseSearchMenu = await engine.process({
  businessId: 'business-1',
  conversation: denseMidday.conversationPatch,
  message: 'otras búsquedas'
})
assert.equal(denseSearchMenu.plan.type, 'show_coordinated_search_menu')
const searchMenuButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: denseSearchMenu.plan,
  state: denseSearchMenu.state
})
assert.deepEqual(searchMenuButtons?.map((button) => button.title), [
  'Todos los horarios',
  'Próximos días',
  'Buscar por hora'
])

const canonicalMoreSchedules = bookingCoordinationMessageFromInteractiveReply(
  searchMenuButtons?.[0]?.id,
  'conversation-1'
)
assert.equal(canonicalMoreSchedules, 'ver más horarios')
const allDaySchedules = await engine.process({
  businessId: 'business-1',
  conversation: denseSearchMenu.conversationPatch,
  message: canonicalMoreSchedules ?? ''
})
assert.equal(allDaySchedules.plan.type, 'offer_coordinated_options')
if (allDaySchedules.plan.type !== 'offer_coordinated_options') throw new Error('Plan inesperado')
assert.equal(allDaySchedules.plan.options.length, 11)
assert.equal(
  new Set(allDaySchedules.plan.options.map((item) => `${item.startTime}-${item.endTime}`)).size,
  allDaySchedules.plan.options.length
)
assert.match(allDaySchedules.reply, /16:00 a 18:00/)
assert.doesNotMatch(allDaySchedules.reply, /^\d+\.\s+\d{2}:\d{2}/m)

for (const [message, expectedStart] of [
  ['1', '08:00'],
  ['opción 4', '12:00'],
  ['a las 15', '15:00'],
  ['16', '16:00'],
  ['1. 15:00', '15:00']
] as const) {
  const selection = await engine.process({
    businessId: 'business-1',
    conversation: allDaySchedules.conversationPatch,
    message
  })
  assert.equal(selection.plan.type, 'show_coordinated_selection', `No avanzó con: ${message}`)
  if (selection.plan.type !== 'show_coordinated_selection') throw new Error('Plan inesperado')
  assert.equal(selection.plan.option.startTime, expectedStart)
  assert.match(selection.reply, /¿Confirmás estas dos reservas\?/)
}

const semanticOptionEngine = new BookingV2Engine(
  domain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  {
    async extract() {
      return { choiceId: 'option:4', confidence: 0.96 }
    }
  }
)
const semanticOptionSelection = await semanticOptionEngine.process({
  businessId: 'business-1',
  conversation: allDaySchedules.conversationPatch,
  message: 'me sirve la alternativa que aparece quinta en la lista'
})
assert.equal(semanticOptionSelection.plan.type, 'show_coordinated_selection')
if (semanticOptionSelection.plan.type !== 'show_coordinated_selection') throw new Error('Plan inesperado')
assert.equal(semanticOptionSelection.plan.option.startTime, '12:30')

const futureDates = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
const futureOptions = futureDates.flatMap((date) => [
  datedOption(date, '09:00'),
  datedOption(date, '12:00'),
  datedOption(date, '13:00', 'lucas'),
  datedOption(date, '15:00')
])
const navigationDomain = {
  ...domain,
  async searchAvailability(input: {
    mode: { type: string; date?: string; requestedTime?: string | null; time?: string }
  }) {
    if (input.mode.type === 'NEXT_DAYS') {
      return {
        ...searchResult('NEXT_DATES_FOUND', futureOptions),
        searchedDates: futureDates
      }
    }
    if (input.mode.type === 'TIME_ACROSS_DAYS') {
      const matches = futureOptions.filter((item) => item.startTime === input.mode.time)
      return {
        ...searchResult(matches.length ? 'NEXT_DATES_FOUND' : 'NO_UPCOMING_AVAILABILITY', matches),
        searchedDates: futureDates,
        requestedTime: input.mode.time ?? null
      }
    }
    const optionsForDate = futureOptions.filter((item) => item.date === input.mode.date)
    const matches = input.mode.requestedTime
      ? optionsForDate.filter((item) => item.startTime === input.mode.requestedTime)
      : optionsForDate
    return {
      ...searchResult(matches.length ? 'AVAILABLE' : 'NO_AVAILABILITY_ON_DATE', matches),
      searchedDates: input.mode.date ? [input.mode.date] : [],
      requestedTime: input.mode.requestedTime ?? null
    }
  }
}
const navigationEngine = new BookingV2Engine(
  navigationDomain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  unusedChoice
)

const canonicalNextDays = bookingCoordinationMessageFromInteractiveReply(
  searchMenuButtons?.[1]?.id,
  'conversation-1'
)
const nextDays = await navigationEngine.process({
  businessId: 'business-1',
  conversation: denseSearchMenu.conversationPatch,
  message: canonicalNextDays ?? '',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(nextDays.plan.type, 'ask_coordinated_date')
if (nextDays.plan.type !== 'ask_coordinated_date') throw new Error('Plan inesperado')
assert.deepEqual(nextDays.plan.quickDates, futureDates)
for (const date of futureDates) assert.match(nextDays.reply, new RegExp(date.split('-').reverse().join('/')))
const nextDateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: nextDays.plan,
  state: nextDays.state
})
const canonicalFutureDate = bookingCoordinationMessageFromInteractiveReply(
  nextDateButtons?.[0]?.id,
  'conversation-1'
)
assert.equal(canonicalFutureDate, '2026-08-10')
const futureDateAvailability = await navigationEngine.process({
  businessId: 'business-1',
  conversation: nextDays.conversationPatch,
  message: canonicalFutureDate ?? ''
})
assert.equal(futureDateAvailability.plan.type, 'ask_coordinated_time_preference')
const futureBandButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: futureDateAvailability.plan,
  state: futureDateAvailability.state
})
const futureBandChoice = bookingCoordinationMessageFromInteractiveReply(
  futureBandButtons?.find((button) => button.title === 'Al mediodía')?.id,
  'conversation-1'
)
const futureMiddayOptions = await navigationEngine.process({
  businessId: 'business-1',
  conversation: futureDateAvailability.conversationPatch,
  message: futureBandChoice ?? ''
})
assert.equal(futureMiddayOptions.plan.type, 'offer_coordinated_options')
const futureConfirmed = await navigationEngine.process({
  businessId: 'business-1',
  conversation: futureMiddayOptions.conversationPatch,
  message: 'opción 1'
})
assert.equal(futureConfirmed.plan.type, 'show_coordinated_selection')
assert.match(futureConfirmed.reply, /¿Confirmás estas dos reservas\?/)

const canonicalSearchByTime = bookingCoordinationMessageFromInteractiveReply(
  searchMenuButtons?.[2]?.id,
  'conversation-1'
)
const askFutureTime = await navigationEngine.process({
  businessId: 'business-1',
  conversation: denseSearchMenu.conversationPatch,
  message: canonicalSearchByTime ?? ''
})
assert.equal(askFutureTime.plan.type, 'ask_coordinated_search_time')
const datesAtThree = await navigationEngine.process({
  businessId: 'business-1',
  conversation: askFutureTime.conversationPatch,
  message: 'a las 15',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(datesAtThree.plan.type, 'ask_coordinated_date')
if (datesAtThree.plan.type !== 'ask_coordinated_date') throw new Error('Plan inesperado')
assert.deepEqual(datesAtThree.plan.quickDates, futureDates)
const timeDateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: datesAtThree.plan,
  state: datesAtThree.state
})
const selectedTimeDate = await navigationEngine.process({
  businessId: 'business-1',
  conversation: datesAtThree.conversationPatch,
  message: bookingCoordinationMessageFromInteractiveReply(timeDateButtons?.[0]?.id, 'conversation-1') ?? ''
})
assert.equal(selectedTimeDate.plan.type, 'show_coordinated_selection')
if (selectedTimeDate.plan.type !== 'show_coordinated_selection') throw new Error('Plan inesperado')
assert.equal(selectedTimeDate.plan.option.startTime, '15:00')

const noDatesAtTen = await navigationEngine.process({
  businessId: 'business-1',
  conversation: askFutureTime.conversationPatch,
  message: 'a las 10',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(noDatesAtTen.plan.type, 'coordinated_date_unavailable')
if (noDatesAtTen.plan.type !== 'coordinated_date_unavailable') throw new Error('Plan inesperado')
assert.equal(noDatesAtTen.plan.searchedHorizonDays, 14)
assert.equal(
  noDatesAtTen.reply,
  'No encontré disponibilidad a las 10:00 en los próximos 14 días.'
)
assert.doesNotMatch(noDatesAtTen.reply, /09\/08\/2026/)

const askRequestedProfessionalFutureTime = await navigationEngine.process({
  businessId: 'business-1',
  conversation: contextualSearchMenu.conversationPatch,
  message: bookingCoordinationMessageFromInteractiveReply(
    contextualSearchMenuButtons?.[2]?.id,
    'conversation-1'
  ) ?? ''
})
const noRequestedProfessionalDatesAtTen = await navigationEngine.process({
  businessId: 'business-1',
  conversation: askRequestedProfessionalFutureTime.conversationPatch,
  message: '10',
  currentDate: new Date('2026-08-09T15:00:00-03:00')
})
assert.equal(
  noRequestedProfessionalDatesAtTen.reply,
  'No encontré disponibilidad a las 10:00 con Tamara en los próximos 14 días.'
)
assert.doesNotMatch(noRequestedProfessionalDatesAtTen.reply, /09\/08\/2026/)

for (const semanticChoiceId of ['show_more', 'next_days', 'search_time'] as const) {
  const fallbackEngine = new BookingV2Engine(
    navigationDomain,
    nullExtractor,
    unusedClassifier,
    unusedDecision,
    unusedOption,
    {
      async extract() {
        return { choiceId: semanticChoiceId, confidence: 0.96 }
      }
    }
  )
  const fallback = await fallbackEngine.process({
    businessId: 'business-1',
    conversation: denseSearchMenu.conversationPatch,
    message: `preferiría resolverlo de otra manera ${semanticChoiceId}`,
    currentDate: new Date('2026-08-09T15:00:00-03:00')
  })
  assert.equal(
    fallback.plan.type,
    semanticChoiceId === 'show_more'
      ? 'offer_coordinated_options'
      : semanticChoiceId === 'next_days'
        ? 'ask_coordinated_date'
        : 'ask_coordinated_search_time'
  )
}

const validationButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: { type: 'ask_service_validation', reason: 'missing' },
  state: denseState
})
assert.deepEqual(validationButtons?.map((button) => button.title), ['Seguir', 'Necesito ayuda'])
assert.equal(validationButtons?.every((button) => button.title.length <= 20), true)
assert.equal(new Set(validationButtons?.map((button) => button.id)).size, 2)
const validationContinueMessage = bookingCoordinationMessageFromInteractiveReply(
  validationButtons?.[0]?.id,
  'conversation-1'
)
const validationHelpMessage = bookingCoordinationMessageFromInteractiveReply(
  validationButtons?.[1]?.id,
  'conversation-1'
)
assert.deepEqual(detectDeterministicConfirmation(validationContinueMessage ?? ''), {
  intent: 'confirm',
  confidence: 0.98
})
assert.deepEqual(detectDeterministicConfirmation(validationHelpMessage ?? ''), {
  intent: 'uncertain',
  confidence: 0.98
})
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  validationButtons?.[0]?.id,
  'otra-conversation'
), null)

const estimateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'show_estimate',
    optionLabel: 'Debajo de los hombros',
    priceMin: 95000,
    priceMax: 110000,
    note: null,
    allowsBooking: true
  },
  state: denseState
})
assert.deepEqual(
  estimateButtons?.map((button) => button.title),
  ['Continuar reserva', 'Presupuesto exacto']
)
assert.equal(estimateButtons?.every((button) => button.title.length <= 20), true)
assert.equal(new Set(estimateButtons?.map((button) => button.id)).size, 2)
const estimateContinueMessage = bookingCoordinationMessageFromInteractiveReply(
  estimateButtons?.[0]?.id,
  'conversation-1'
)
const estimateQuoteMessage = bookingCoordinationMessageFromInteractiveReply(
  estimateButtons?.[1]?.id,
  'conversation-1'
)
const estimateDecisionExtractor = new BookingV2EstimateDecisionExtractor()
assert.deepEqual(await estimateDecisionExtractor.extract({
  message: estimateContinueMessage ?? '',
  serviceName: 'Alisado (sin formol)',
  allowsBooking: true,
  requiresPhoto: false
}), { decision: 'continue_booking', confidence: 0.98 })
assert.deepEqual(await estimateDecisionExtractor.extract({
  message: estimateQuoteMessage ?? '',
  serviceName: 'Alisado (sin formol)',
  allowsBooking: true,
  requiresPhoto: false
}), { decision: 'request_exact_quote', confidence: 0.98 })

const estimateOptionButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'ask_estimate_option',
    reason: 'missing',
    options: [
      { id: 'short', label: 'Hasta los hombros' },
      { id: 'medium', label: 'Debajo de los hombros' },
      { id: 'long', label: 'Debajo de la escápula' }
    ]
  },
  state: denseState
})
assert.deepEqual(estimateOptionButtons?.map((button) => button.title), [
  'Hasta los hombros',
  'Debajo de hombros',
  'Debajo de escápula'
])
assert.deepEqual(
  estimateOptionButtons?.map((button) => bookingCoordinationMessageFromInteractiveReply(
    button.id,
    'conversation-1'
  )),
  ['estimate-option:short', 'estimate-option:medium', 'estimate-option:long']
)

const largeEstimateOptionButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'ask_estimate_option',
    reason: 'missing',
    options: [
      { id: 'one', label: 'Opción uno' },
      { id: 'two', label: 'Opción dos' },
      { id: 'three', label: 'Opción tres' },
      { id: 'four', label: 'Opción cuatro' }
    ]
  },
  state: denseState
})
assert.deepEqual(
  largeEstimateOptionButtons?.map((button) => button.title),
  ['Presupuesto exacto']
)

const standardTimeButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: { type: 'ask_field', field: 'time', reason: 'missing', misunderstandingCount: 0 },
  state: denseState,
  availabilityOptions: [
    { time: '12:00' },
    { time: '12:30' },
    { time: '13:00' },
    { time: '13:30' }
  ]
})
assert.deepEqual(standardTimeButtons?.map((button) => button.title), ['12:00', '12:30', '13:00'])
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  standardTimeButtons?.[2]?.id,
  'conversation-1'
), '13:00')

const standardConfirmationButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: { type: 'confirm_booking' },
  state: denseState
})
assert.deepEqual(
  standardConfirmationButtons?.map((button) => button.title),
  ['Confirmar turno', 'Cambiar horario', 'Cancelar reserva']
)
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  standardConfirmationButtons?.[0]?.id,
  'conversation-1'
), 'confirmar turno')

const addonButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: { type: 'ask_service_addons', serviceIds: ['corte-mujer', 'bano-crema', 'lavado'] },
  state: denseState
})
assert.deepEqual(
  addonButtons?.map((button) => button.title),
  ['Agregar opción 1', 'Agregar todas', 'No, continuar']
)
assert.equal(addonButtons?.every((button) => button.title.length <= 20), true)
assert.equal(new Set(addonButtons?.map((button) => button.id)).size, 3)
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  addonButtons?.[0]?.id,
  'conversation-1'
), '1')
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  addonButtons?.[1]?.id,
  'conversation-1'
), 'agregar todos los servicios sugeridos')
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  addonButtons?.[2]?.id,
  'conversation-1'
), 'No, continuar')

const bookingDateButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: {
    type: 'ask_field',
    field: 'date',
    reason: 'missing',
    misunderstandingCount: 0
  },
  state: denseState
})
assert.deepEqual(
  bookingDateButtons?.map((button) => button.title),
  ['Hoy', 'Mañana', 'Otra fecha']
)
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  bookingDateButtons?.[0]?.id,
  'conversation-1'
), 'hoy')
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  bookingDateButtons?.[1]?.id,
  'conversation-1'
), 'mañana')
assert.equal(bookingCoordinationMessageFromInteractiveReply(
  bookingDateButtons?.[2]?.id,
  'conversation-1'
), 'elegir otra fecha')

for (const buttons of [
  bookingDateButtons,
  addonButtons,
  estimateButtons,
  estimateOptionButtons,
  largeEstimateOptionButtons,
  validationButtons,
  decisionButtons,
  modificationButtons,
  dateButtons,
  bandButtons,
  twoBandButtons,
  unavailableButtons,
  unavailableWithTamaraButtons,
  moreButtons,
  optionButtons,
  searchMenuButtons,
  contextualSearchMenuButtons,
  nextDateButtons,
  futureBandButtons,
  timeDateButtons,
  repeatedTimeButtons,
  selectionButtons
]) {
  assert.equal(
    buttons?.every((button) => Boolean(
      bookingCoordinationMessageFromInteractiveReply(button.id, 'conversation-1')
    )),
    true
  )
  if (!buttons?.length) continue
  if (buttons.length > 3) {
    const payload = buildWhatsAppInteractiveListPayload({
      to: '5491112345678',
      text: 'Elegí una opción',
      rows: buttons,
      buttonText: 'Ver opciones',
      sectionTitle: 'Elegí una opción'
    })
    assert.equal(payload.interactive.type, 'list')
    assert.equal(payload.interactive.action.sections[0]?.rows.length, buttons.length)
    for (const row of payload.interactive.action.sections[0]?.rows ?? []) {
      const incoming = new WhatsAppWebhookService().extractIncomingMessages({
        entry: [{
          changes: [{
            value: {
              messages: [{
                id: `wamid.${row.id}`,
                from: '5491112345678',
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: row
                }
              }]
            }
          }]
        }]
      })[0]
      assert.equal(incoming?.interactiveReplyId, row.id)
      assert.ok(bookingCoordinationMessageFromInteractiveReply(
        incoming?.interactiveReplyId,
        'conversation-1'
      ))
    }
    continue
  }
  const payload = buildWhatsAppReplyButtonsPayload({
    to: '5491112345678',
    text: 'Elegí una opción',
    buttons
  })
  for (const button of payload.interactive.action.buttons) {
    const incoming = new WhatsAppWebhookService().extractIncomingMessages({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: `wamid.${button.reply.id}`,
              from: '5491112345678',
              type: 'interactive',
              interactive: {
                type: 'button_reply',
                button_reply: button.reply
              }
            }]
          }
        }]
      }]
    })[0]
    assert.equal(incoming?.interactiveReplyId, button.reply.id)
    assert.ok(bookingCoordinationMessageFromInteractiveReply(
      incoming?.interactiveReplyId,
      'conversation-1'
    ))
  }
}

const restored = stateFromConversation(conversationPatchFromState(midday.state))
assert.deepEqual(restored.pendingCoordinatedAvailability, midday.state.pendingCoordinatedAvailability)
assert.equal(searchCalls.some((call) => call.type === 'DATE' && call.date === '2026-08-10'), true)

function singleOption(startTime: string, endTime: string): BookingAvailabilitySearchOption {
  return {
    id: `single|${startTime}`,
    date: '2026-08-10',
    startTime,
    endTime,
    preferredProfessionalRespected: true,
    segments: [{
      serviceId: 'color',
      serviceName: 'Color Completo',
      professionalId: 'tamara',
      professionalName: 'Tamara',
      startTime,
      endTime
    }]
  }
}
const singleOptions = [
  singleOption('09:00', '10:30'),
  singleOption('12:00', '13:30'),
  singleOption('15:00', '16:30')
]
const singleDomain = {
  ...domain,
  async findAvailabilityOptions() {
    return {
      ok: true as const,
      options: singleOptions.map((item) => ({
        time: item.startTime,
        professionalId: 'tamara',
        professionalName: 'Tamara'
      }))
    }
  },
  async searchAvailability() {
    return searchResult('AVAILABLE', singleOptions)
  }
}
const singleEngine = new BookingV2Engine(
  singleDomain,
  nullExtractor,
  unusedClassifier,
  unusedDecision,
  unusedOption,
  unusedChoice
)
let singleState = acceptField(createEmptyBookingV2State(), 'name', 'Matías')
singleState = acceptField(singleState, 'service', 'color')
singleState = acceptField(singleState, 'professional', 'tamara')
singleState = acceptField(singleState, 'date', '2026-08-10')
const singleAvailability = await singleEngine.resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(singleState)
})
assert.equal(singleAvailability.plan.type, 'ask_coordinated_time_preference')
assert.equal(singleAvailability.state.pendingCoordinatedAvailability?.assignmentMode, 'SINGLE_PROFESSIONAL')
const restoredSingleAvailability = stateFromConversation(singleAvailability.conversationPatch)
assert.equal(restoredSingleAvailability.pendingCoordinatedAvailability?.phase, 'AWAITING_TIME_PREFERENCE')
assert.deepEqual(
  restoredSingleAvailability.pendingCoordinatedAvailability?.options.map((item) => item.startTime),
  ['09:00', '12:00', '15:00']
)
const singleMidday = await singleEngine.process({
  businessId: 'business-1',
  conversation: singleAvailability.conversationPatch,
  message: 'al mediodía'
})
assert.equal(singleMidday.plan.type, 'offer_coordinated_options')
const singleConfirmed = await singleEngine.process({
  businessId: 'business-1',
  conversation: singleMidday.conversationPatch,
  message: '1'
})
assert.equal(singleConfirmed.plan.type, 'show_coordinated_selection')
assert.equal(singleConfirmed.state.pendingCoordinatedAvailability?.selectedOptionId, singleOptions[1]?.id)
assert.match(singleConfirmed.reply, /¿Confirmás la reserva\?/)
const singleConfirmationButtons = bookingCoordinationReplyButtons({
  conversationId: 'conversation-1',
  plan: singleConfirmed.plan,
  state: singleConfirmed.state
})
assert.deepEqual(singleConfirmationButtons?.map((button) => button.title), [
  'Confirmar turno',
  'Cambiar horario',
  'Solicitar atención'
])

console.log('booking-coordinated-flow-contract-test: OK')
