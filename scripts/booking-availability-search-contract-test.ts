import assert from 'node:assert/strict'
import {
  BookingAvailabilitySearchEngine,
  type BookingAvailabilitySearchService
} from '../src/services/booking-availability-search.js'
import {
  aggregateBookingAvailabilityUnavailableReason,
  bookingAvailabilityUnavailableReason,
  classifyBookingAvailabilityUnavailable
} from '../src/services/booking-availability-reason.js'
import {
  BookingV2DomainService,
  createBookingV2DomainCatalog
} from '../src/services/booking-v2-domain.js'

const services: BookingAvailabilitySearchService[] = [
  {
    id: 'color',
    name: 'Color',
    durationMinutes: 90,
    customerDurationMinutes: 90,
    professionalIds: ['tamara']
  },
  {
    id: 'corte',
    name: 'Corte',
    durationMinutes: 30,
    customerDurationMinutes: 30,
    professionalIds: ['julian']
  }
]

const professionals = [
  { id: 'tamara', name: 'Tamara' },
  { id: 'julian', name: 'Julián' }
]

const slots = new Map<string, string[]>([
  ['2026-08-10:color:tamara', ['15:00', '16:00']],
  ['2026-08-10:corte:julian', ['16:30', '18:00']],
  ['2026-08-11:color:tamara', ['10:00']],
  ['2026-08-11:corte:julian', ['12:00']],
  ['2026-08-12:color:tamara', ['15:00']],
  ['2026-08-12:corte:julian', ['16:30']],
  ['2026-08-13:color:tamara', ['09:00']],
  ['2026-08-13:corte:julian', ['10:30']]
])
const calls: string[] = []
const engine = new BookingAvailabilitySearchEngine(async (input) => {
  const key = `${input.date}:${input.serviceIds.join('+')}:${input.professionalId}`
  calls.push(key)
  return { ok: true, slots: slots.get(key) ?? [] }
})

const onDate = await engine.search({
  mode: { type: 'DATE', date: '2026-08-10' },
  services,
  professionals,
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(onDate.status, 'AVAILABLE')
assert.equal(onDate.options.length, 1)
assert.equal(onDate.options[0]?.startTime, '15:00')
assert.equal(onDate.options[0]?.endTime, '17:00')
assert.deepEqual(onDate.options[0]?.segments.map((segment) => ({
  serviceId: segment.serviceId,
  professionalId: segment.professionalId,
  startTime: segment.startTime,
  endTime: segment.endTime
})), [
  { serviceId: 'color', professionalId: 'tamara', startTime: '15:00', endTime: '16:30' },
  { serviceId: 'corte', professionalId: 'julian', startTime: '16:30', endTime: '17:00' }
])

const unavailableTime = await engine.search({
  mode: { type: 'DATE', date: '2026-08-10', requestedTime: '14:00' },
  services,
  professionals,
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(unavailableTime.status, 'REQUESTED_TIME_UNAVAILABLE')
assert.equal(unavailableTime.options[0]?.startTime, '15:00')

const nearestTimeEngine = new BookingAvailabilitySearchEngine(async (input) => ({
  ok: true as const,
  slots: input.professionalId === 'julian'
    ? [
        '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
        '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
        '19:00', '19:30'
      ]
    : []
}))
const unavailableLateTime = await nearestTimeEngine.search({
  mode: { type: 'DATE', date: '2026-08-10', requestedTime: '19:20' },
  services: [services[1]!],
  professionals,
  assignmentMode: 'SINGLE_PROFESSIONAL',
  maxResults: 3
})
assert.equal(unavailableLateTime.status, 'REQUESTED_TIME_UNAVAILABLE')
assert.deepEqual(
  unavailableLateTime.options.map((option) => option.startTime),
  ['19:30', '19:00', '18:30']
)

const noContinuousBlock = await engine.search({
  mode: { type: 'DATE', date: '2026-08-11' },
  services,
  professionals,
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(noContinuousBlock.status, 'NO_CONTINUOUS_COMBINATION')
assert.equal(noContinuousBlock.individualAvailabilityFound, true)
assert.deepEqual(noContinuousBlock.options, [])

const nextDays = await engine.search({
  mode: {
    type: 'NEXT_DAYS',
    afterDate: '2026-08-10',
    horizonDays: 3,
    maxDates: 2
  },
  services,
  professionals,
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(nextDays.status, 'NEXT_DATES_FOUND')
assert.deepEqual(nextDays.options.map((option) => option.date), ['2026-08-12', '2026-08-13'])

const denseFutureEngine = new BookingAvailabilitySearchEngine(async (input) => {
  const dateNumber = Number(input.date.slice(-2))
  const times = dateNumber >= 11 && dateNumber <= 15
    ? ['09:00', '10:00', '11:00', '12:00', '13:00']
    : []
  return { ok: true, slots: times }
})
const fiveFutureDates = await denseFutureEngine.search({
  mode: {
    type: 'NEXT_DAYS',
    afterDate: '2026-08-10',
    horizonDays: 5,
    maxDates: 5
  },
  services: [{
    id: 'corte',
    name: 'Corte',
    durationMinutes: 30,
    customerDurationMinutes: 30,
    professionalIds: ['julian']
  }],
  professionals: [{ id: 'julian', name: 'Julián' }],
  assignmentMode: 'SINGLE_PROFESSIONAL',
  maxResults: 5
})
assert.equal(fiveFutureDates.status, 'NEXT_DATES_FOUND')
assert.deepEqual(
  fiveFutureDates.options.map((item) => item.date),
  ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']
)

const timeAcrossDays = await engine.search({
  mode: {
    type: 'TIME_ACROSS_DAYS',
    afterDate: '2026-08-10',
    time: '15:00',
    horizonDays: 3,
    maxDates: 2
  },
  services,
  professionals,
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(timeAcrossDays.status, 'NEXT_DATES_FOUND')
assert.deepEqual(timeAcrossDays.options.map((option) => option.date), ['2026-08-12'])
assert.equal(timeAcrossDays.options[0]?.startTime, '15:00')

const noCommonProfessional = await engine.search({
  mode: { type: 'DATE', date: '2026-08-10' },
  services,
  professionals,
  assignmentMode: 'SINGLE_PROFESSIONAL'
})
assert.equal(noCommonProfessional.status, 'NO_COMPATIBLE_PROFESSIONAL')

const preferred = await engine.search({
  mode: { type: 'DATE', date: '2026-08-10' },
  services: [{
    id: 'corte',
    name: 'Corte',
    durationMinutes: 30,
    customerDurationMinutes: 30,
    professionalIds: ['tamara', 'julian']
  }],
  professionals,
  assignmentMode: 'MULTIPLE_PROFESSIONALS',
  preferredProfessionalId: 'julian'
})
assert.equal(preferred.status, 'AVAILABLE')
assert.equal(preferred.options[0]?.segments[0]?.professionalId, 'julian')
assert.equal(preferred.options[0]?.preferredProfessionalRespected, true)

assert.equal(calls.includes('2026-08-10:color:tamara'), true)
assert.equal(calls.includes('2026-08-10:corte:julian'), true)

const domainCatalog = createBookingV2DomainCatalog({
  services: [
    { id: 'color', name: 'Color', aliases: [], duration: 90, price: 1, category: 'Color' },
    { id: 'corte', name: 'Corte', aliases: [], duration: 30, price: 1, category: 'Corte' }
  ],
  professionals: [
    { id: 'tamara', name: 'Tamara', serviceIds: ['color'] },
    { id: 'julian', name: 'Julián', serviceIds: ['corte'] }
  ]
})
const domain = new BookingV2DomainService({} as never, {
  async getAvailability(input) {
    return {
      ok: true as const,
      slots: slots.get(`${input.date}:${input.serviceIds?.join('+')}:${input.professionalId}`) ?? []
    }
  },
  async createAppointment() {
    return { ok: false as const, statusCode: 501, message: 'No se usa en esta prueba' }
  },
  async cancelAppointment() {}
})
const domainCombination = await domain.searchAvailability({
  catalog: domainCatalog,
  serviceId: 'color',
  serviceIds: ['color', 'corte'],
  mode: { type: 'DATE', date: '2026-08-10' },
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(domainCombination.status, 'AVAILABLE')
assert.deepEqual(
  domainCombination.options[0]?.segments.map((segment) => segment.professionalId),
  ['tamara', 'julian']
)

const requestedProfessionalEngine = new BookingAvailabilitySearchEngine(async (input) => {
  const requestedSlots: Record<string, string[]> = {
    'color:tamara': ['10:00'],
    'color:sofia': ['10:00'],
    'corte:julian': ['11:30']
  }
  return { ok: true, slots: requestedSlots[`${input.serviceIds[0]}:${input.professionalId}`] ?? [] }
})
const requiredTamara = await requestedProfessionalEngine.search({
  mode: { type: 'DATE', date: '2026-08-10' },
  services: [
    { ...services[0]!, professionalIds: ['tamara', 'sofia'] },
    services[1]!
  ],
  professionals: [...professionals, { id: 'sofia', name: 'Sofía' }],
  assignmentMode: 'MULTIPLE_PROFESSIONALS',
  requiredProfessionalId: 'tamara'
})
assert.equal(requiredTamara.status, 'AVAILABLE')
assert.equal(requiredTamara.options.length, 1)
assert.equal(requiredTamara.options[0]?.segments[0]?.professionalId, 'tamara')
assert.equal(requiredTamara.options[0]?.preferredProfessionalRespected, true)

const repeatedBlockEngine = new BookingAvailabilitySearchEngine(async (input) => {
  const repeatedSlots: Record<string, string[]> = {
    'color:tamara': ['10:00'],
    'corte:julian': ['11:30'],
    'corte:lucas': ['11:30']
  }
  return { ok: true, slots: repeatedSlots[`${input.serviceIds[0]}:${input.professionalId}`] ?? [] }
})
const repeatedBlock = await repeatedBlockEngine.search({
  mode: { type: 'DATE', date: '2026-08-10' },
  services: [
    services[0]!,
    { ...services[1]!, professionalIds: ['julian', 'lucas'] }
  ],
  professionals: [...professionals, { id: 'lucas', name: 'Lucas' }],
  assignmentMode: 'MULTIPLE_PROFESSIONALS'
})
assert.equal(repeatedBlock.status, 'AVAILABLE')
assert.equal(repeatedBlock.options.length, 1)
assert.equal(repeatedBlock.options[0]?.startTime, '10:00')
assert.equal(repeatedBlock.options[0]?.endTime, '12:00')

assert.deepEqual(classifyBookingAvailabilityUnavailable({
  businessHasHours: false,
  professionalHasHours: false,
  hasOverlappingWindow: false,
  businessFullDayBlocked: false,
  professionalFullDayBlocked: false
}), bookingAvailabilityUnavailableReason('BUSINESS_CLOSED'))

assert.deepEqual(classifyBookingAvailabilityUnavailable({
  businessHasHours: true,
  professionalHasHours: false,
  hasOverlappingWindow: false,
  businessFullDayBlocked: false,
  professionalFullDayBlocked: false,
  professionalName: 'Gaspar'
}), bookingAvailabilityUnavailableReason('PROFESSIONAL_NOT_WORKING', 'Gaspar'))

assert.deepEqual(classifyBookingAvailabilityUnavailable({
  businessHasHours: true,
  professionalHasHours: true,
  hasOverlappingWindow: true,
  businessFullDayBlocked: false,
  professionalFullDayBlocked: false
}), bookingAvailabilityUnavailableReason('NO_SLOTS'))

assert.deepEqual(aggregateBookingAvailabilityUnavailableReason([
  bookingAvailabilityUnavailableReason('PROFESSIONAL_NOT_WORKING', 'Gaspar'),
  bookingAvailabilityUnavailableReason('PROFESSIONAL_NOT_WORKING', 'Nico')
], false), bookingAvailabilityUnavailableReason('NO_SLOTS'))

console.log('booking-availability-search-contract-test: OK')
