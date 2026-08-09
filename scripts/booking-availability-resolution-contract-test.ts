import assert from 'node:assert/strict'
import {
  applyBookingAvailabilityTransition,
  bookingAvailabilityFailureRecovery,
  bookingAvailabilityResolutionPlan,
  parsePendingAvailabilityResolution,
  pendingAvailabilityResolution,
  resolveBookingAvailability
} from '../src/services/booking-availability-resolution.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'
import {
  acceptField,
  createEmptyBookingV2State
} from '../src/services/booking-v2-state.js'

const dailyOptions = [
  { time: '15:00', professionalId: 'julian', professionalName: 'Julián' },
  { time: '16:00', professionalId: 'julian', professionalName: 'Julián' }
]

assert.deepEqual(resolveBookingAvailability({
  stage: 'professional_compatibility',
  serviceCount: 2,
  hasCompatibleProfessional: false
}), { status: 'NO_COMMON_PROFESSIONAL' })

const noCommonProfessionalPlan = bookingAvailabilityResolutionPlan({
  status: 'NO_COMMON_PROFESSIONAL'
}, { hasSelectedProfessional: false })
assert.deepEqual(noCommonProfessionalPlan, {
  transition: 'PRESERVE_SELECTION',
  actions: ['COORDINATE_SEPARATELY', 'CHANGE_SERVICES', 'REQUEST_HUMAN']
})

assert.deepEqual(resolveBookingAvailability({
  stage: 'professional_compatibility',
  serviceCount: 1,
  hasCompatibleProfessional: false
}), { status: 'NO_COMPATIBLE_PROFESSIONAL' })

assert.deepEqual(resolveBookingAvailability({
  stage: 'daily_availability',
  options: []
}), { status: 'NO_SLOTS_ON_DATE' })

assert.deepEqual(resolveBookingAvailability({
  stage: 'daily_availability',
  options: dailyOptions,
  requestedTime: '18:00'
}), {
  status: 'REQUESTED_TIME_UNAVAILABLE',
  requestedTime: '18:00',
  options: dailyOptions
})

const upcomingOptions = [{
  date: '2026-08-11',
  time: '15:00',
  professionalId: 'julian',
  professionalName: 'Julián'
}]
assert.deepEqual(resolveBookingAvailability({
  stage: 'daily_availability',
  options: [],
  upcomingSearch: { performed: true, options: upcomingOptions }
}), {
  status: 'UPCOMING_AVAILABILITY_FOUND',
  options: upcomingOptions
})

assert.deepEqual(resolveBookingAvailability({
  stage: 'daily_availability',
  options: [],
  upcomingSearch: { performed: true, options: [] }
}), { status: 'NO_UPCOMING_AVAILABILITY' })

assert.deepEqual(resolveBookingAvailability({
  stage: 'daily_availability',
  options: dailyOptions,
  requestedTime: '15:00'
}), { status: 'AVAILABLE', options: dailyOptions })

assert.deepEqual(resolveBookingAvailability({
  stage: 'confirmation',
  statusCode: 409,
  message: 'Ese horario ya no está disponible'
}), {
  status: 'CONFIRMATION_CONFLICT',
  message: 'Ese horario ya no está disponible'
})

assert.deepEqual(resolveBookingAvailability({
  stage: 'confirmation',
  statusCode: 404,
  message: 'No encontré el profesional'
}), {
  status: 'PROVIDER_REJECTION',
  statusCode: 404,
  message: 'No encontré el profesional'
})

const unavailableTimeResolution = resolveBookingAvailability({
  stage: 'daily_availability',
  options: dailyOptions,
  requestedTime: '18:00'
})
assert.deepEqual(
  bookingAvailabilityResolutionPlan(unavailableTimeResolution, {
    hasSelectedProfessional: true
  }),
  {
    transition: 'CLEAR_TIME',
    actions: [
      'SEARCH_EXACT_TIME',
      'SHOW_NEXT_DAYS',
      'CHOOSE_OTHER_DATE',
      'CHANGE_PROFESSIONAL',
      'REQUEST_HUMAN'
    ]
  }
)

let completeState = createEmptyBookingV2State()
completeState = acceptField(completeState, 'name', 'Mati')
completeState = acceptField(completeState, 'service', 'color')
completeState = acceptField(completeState, 'professional', 'julian')
completeState = acceptField(completeState, 'date', '2026-08-10')
completeState = acceptField(completeState, 'time', '18:00')
const pending = pendingAvailabilityResolution({
  resolution: unavailableTimeResolution,
  serviceIds: ['color'],
  professionalId: 'julian',
  requestedDate: '2026-08-10',
  requestedTime: '18:00'
})
assert.ok(pending)
const stateWithPending = {
  ...applyBookingAvailabilityTransition(completeState, 'CLEAR_TIME'),
  pendingAvailabilityResolution: pending
}
assert.equal(stateWithPending.draft.date, '2026-08-10')
assert.equal(stateWithPending.draft.time, null)

const persisted = conversationPatchFromState(stateWithPending)
const restored = stateFromConversation(persisted)
assert.deepEqual(restored.pendingAvailabilityResolution, pending)
assert.equal(restored.draft.date, '2026-08-10')
assert.equal(restored.draft.time, null)

assert.equal(parsePendingAvailabilityResolution({
  ...pending,
  actions: ['INVENTED_ACTION']
}), null)

const providerRejectionPending = pendingAvailabilityResolution({
  resolution: {
    status: 'PROVIDER_REJECTION',
    statusCode: 503,
    message: 'La agenda no respondió'
  },
  serviceIds: ['color'],
  professionalId: '__any_professional__',
  requestedDate: '2026-08-10',
  requestedTime: '18:00'
})
assert.ok(providerRejectionPending)
assert.equal(providerRejectionPending.actions.includes('CHANGE_PROFESSIONAL'), false)
assert.deepEqual(parsePendingAvailabilityResolution(providerRejectionPending), providerRejectionPending)

const confirmationRecovery = bookingAvailabilityFailureRecovery({
  state: {
    ...completeState,
    pendingDeposit: {
      depositId: 'deposit-1',
      appointmentId: 'appointment-1',
      serviceId: 'color',
      mode: 'FIXED',
      configuredValue: 10000,
      baseAmount: null,
      amount: 10000,
      status: 'awaiting_proof',
      expiresAt: '2026-08-10T18:00:00.000Z'
    }
  },
  statusCode: 409,
  message: 'Ese horario ya no está disponible'
})
assert.equal(confirmationRecovery.resolution.status, 'CONFIRMATION_CONFLICT')
assert.equal(confirmationRecovery.plan.transition, 'CLEAR_DATE_AND_TIME')
assert.equal(confirmationRecovery.state.draft.professional, 'julian')
assert.equal(confirmationRecovery.state.draft.date, null)
assert.equal(confirmationRecovery.state.draft.time, null)
assert.equal(confirmationRecovery.state.pendingDeposit, null)
assert.equal(
  confirmationRecovery.state.pendingAvailabilityResolution?.status,
  'CONFIRMATION_CONFLICT'
)

console.log('booking-availability-resolution-contract-test: OK')
