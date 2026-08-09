import type {
  BookingV2AvailabilityOption,
  BookingV2DatedAvailabilityOption
} from './booking-v2-domain.js'
import { normalizeText } from './message-understanding-service.js'
import {
  ANY_PROFESSIONAL_ID,
  clearFieldAndDependents,
  combinedServiceIds,
  type BookingV2State
} from './booking-v2-state.js'

export type BookingAvailabilityResolution =
  | {
      status: 'AVAILABLE'
      options: BookingV2AvailabilityOption[]
    }
  | {
      status: 'NO_COMMON_PROFESSIONAL'
    }
  | {
      status: 'NO_COMPATIBLE_PROFESSIONAL'
    }
  | {
      status: 'NO_SLOTS_ON_DATE'
    }
  | {
      status: 'REQUESTED_TIME_UNAVAILABLE'
      requestedTime: string
      options: BookingV2AvailabilityOption[]
    }
  | {
      status: 'UPCOMING_AVAILABILITY_FOUND'
      options: BookingV2DatedAvailabilityOption[]
    }
  | {
      status: 'NO_UPCOMING_AVAILABILITY'
    }
  | {
      status: 'CONFIRMATION_CONFLICT'
      message: string
    }
  | {
      status: 'PROVIDER_REJECTION'
      statusCode: number
      message: string
    }

export type BookingAvailabilityAction =
  | 'SEARCH_EXACT_TIME'
  | 'SHOW_NEXT_DAYS'
  | 'CHOOSE_OTHER_DATE'
  | 'CHANGE_PROFESSIONAL'
  | 'COORDINATE_SEPARATELY'
  | 'CHANGE_SERVICES'
  | 'REQUEST_HUMAN'

const PENDING_AVAILABILITY_STATUSES: BookingV2PendingAvailabilityResolution['status'][] = [
  'NO_COMMON_PROFESSIONAL',
  'NO_COMPATIBLE_PROFESSIONAL',
  'NO_SLOTS_ON_DATE',
  'REQUESTED_TIME_UNAVAILABLE',
  'UPCOMING_AVAILABILITY_FOUND',
  'NO_UPCOMING_AVAILABILITY',
  'CONFIRMATION_CONFLICT',
  'PROVIDER_REJECTION'
]

const AVAILABILITY_ACTIONS: BookingAvailabilityAction[] = [
  'SEARCH_EXACT_TIME',
  'SHOW_NEXT_DAYS',
  'CHOOSE_OTHER_DATE',
  'CHANGE_PROFESSIONAL',
  'COORDINATE_SEPARATELY',
  'CHANGE_SERVICES',
  'REQUEST_HUMAN'
]

export type BookingAvailabilityTransition =
  | 'PRESERVE_SELECTION'
  | 'CLEAR_TIME'
  | 'CLEAR_DATE_AND_TIME'

export type BookingAvailabilityResolutionPlan = {
  transition: BookingAvailabilityTransition
  actions: BookingAvailabilityAction[]
}

export type BookingV2PendingAvailabilityResolution = {
  status: Exclude<BookingAvailabilityResolution['status'], 'AVAILABLE'>
  transition: BookingAvailabilityTransition
  actions: BookingAvailabilityAction[]
  serviceIds: string[]
  professionalId: string | null
  requestedDate: string | null
  requestedTime: string | null
  options: BookingV2DatedAvailabilityOption[]
}

export type BookingAvailabilityResolutionInput =
  | {
      stage: 'professional_compatibility'
      serviceCount: number
      hasCompatibleProfessional: boolean
    }
  | {
      stage: 'daily_availability'
      options: BookingV2AvailabilityOption[]
      requestedTime?: string | null
      upcomingSearch?:
        | { performed: false }
        | { performed: true; options: BookingV2DatedAvailabilityOption[] }
    }
  | {
      stage: 'confirmation'
      statusCode: number
      message: string
    }

export function resolveBookingAvailability(
  input: BookingAvailabilityResolutionInput
): BookingAvailabilityResolution {
  if (input.stage === 'professional_compatibility') {
    if (input.hasCompatibleProfessional) {
      return { status: 'AVAILABLE', options: [] }
    }
    return input.serviceCount > 1
      ? { status: 'NO_COMMON_PROFESSIONAL' }
      : { status: 'NO_COMPATIBLE_PROFESSIONAL' }
  }

  if (input.stage === 'confirmation') {
    return isOccupiedConfirmationConflict(input.statusCode, input.message)
      ? { status: 'CONFIRMATION_CONFLICT', message: input.message }
      : {
          status: 'PROVIDER_REJECTION',
          statusCode: input.statusCode,
          message: input.message
        }
  }

  if (input.options.length > 0) {
    if (
      input.requestedTime &&
      !input.options.some((option) => option.time === input.requestedTime)
    ) {
      return {
        status: 'REQUESTED_TIME_UNAVAILABLE',
        requestedTime: input.requestedTime,
        options: input.options
      }
    }
    return { status: 'AVAILABLE', options: input.options }
  }

  if (input.upcomingSearch?.performed) {
    return input.upcomingSearch.options.length > 0
      ? {
          status: 'UPCOMING_AVAILABILITY_FOUND',
          options: input.upcomingSearch.options
        }
      : { status: 'NO_UPCOMING_AVAILABILITY' }
  }

  return { status: 'NO_SLOTS_ON_DATE' }
}

export function bookingAvailabilityResolutionPlan(
  resolution: BookingAvailabilityResolution,
  context: { hasSelectedProfessional: boolean }
): BookingAvailabilityResolutionPlan {
  switch (resolution.status) {
    case 'AVAILABLE':
      return { transition: 'PRESERVE_SELECTION', actions: [] }
    case 'NO_COMMON_PROFESSIONAL':
      return {
        transition: 'PRESERVE_SELECTION',
        actions: ['COORDINATE_SEPARATELY', 'CHANGE_SERVICES', 'REQUEST_HUMAN']
      }
    case 'NO_COMPATIBLE_PROFESSIONAL':
      return {
        transition: 'PRESERVE_SELECTION',
        actions: ['CHANGE_PROFESSIONAL', 'CHANGE_SERVICES', 'REQUEST_HUMAN']
      }
    case 'REQUESTED_TIME_UNAVAILABLE':
      return {
        transition: 'CLEAR_TIME',
        actions: [
          'SEARCH_EXACT_TIME',
          'SHOW_NEXT_DAYS',
          'CHOOSE_OTHER_DATE',
          ...(context.hasSelectedProfessional ? ['CHANGE_PROFESSIONAL' as const] : []),
          'REQUEST_HUMAN'
        ]
      }
    case 'UPCOMING_AVAILABILITY_FOUND':
      return {
        transition: 'CLEAR_DATE_AND_TIME',
        actions: ['SHOW_NEXT_DAYS', 'CHOOSE_OTHER_DATE', 'REQUEST_HUMAN']
      }
    case 'NO_SLOTS_ON_DATE':
    case 'NO_UPCOMING_AVAILABILITY':
    case 'CONFIRMATION_CONFLICT':
    case 'PROVIDER_REJECTION':
      return {
        transition: 'CLEAR_DATE_AND_TIME',
        actions: [
          'SEARCH_EXACT_TIME',
          'SHOW_NEXT_DAYS',
          'CHOOSE_OTHER_DATE',
          ...(context.hasSelectedProfessional ? ['CHANGE_PROFESSIONAL' as const] : []),
          'REQUEST_HUMAN'
        ]
      }
  }
}

export function pendingAvailabilityResolution(input: {
  resolution: BookingAvailabilityResolution
  serviceIds: string[]
  professionalId: string | null
  requestedDate: string | null
  requestedTime: string | null
}): BookingV2PendingAvailabilityResolution | null {
  if (input.resolution.status === 'AVAILABLE') return null
  const plan = bookingAvailabilityResolutionPlan(input.resolution, {
    hasSelectedProfessional: Boolean(
      input.professionalId && input.professionalId !== ANY_PROFESSIONAL_ID
    )
  })
  const options = input.resolution.status === 'UPCOMING_AVAILABILITY_FOUND'
    ? input.resolution.options
    : input.resolution.status === 'REQUESTED_TIME_UNAVAILABLE' && input.requestedDate
      ? input.resolution.options.map((option) => ({ ...option, date: input.requestedDate! }))
      : []
  return {
    status: input.resolution.status,
    transition: plan.transition,
    actions: plan.actions,
    serviceIds: Array.from(new Set(input.serviceIds)).slice(0, 5),
    professionalId: input.professionalId,
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    options: options.slice(0, 15)
  }
}

export function applyBookingAvailabilityTransition(
  state: BookingV2State,
  transition: BookingAvailabilityTransition
): BookingV2State {
  if (transition === 'PRESERVE_SELECTION') return state
  const field = transition === 'CLEAR_TIME' ? 'time' : 'date'
  return {
    ...state,
    draft: clearFieldAndDependents(state.draft, field),
    pendingProposal: null
  }
}

export function bookingAvailabilityFailureRecovery(input: {
  state: BookingV2State
  statusCode: number
  message: string
}) {
  const resolution = resolveBookingAvailability({
    stage: 'confirmation',
    statusCode: input.statusCode,
    message: input.message
  })
  const plan = bookingAvailabilityResolutionPlan(resolution, {
    hasSelectedProfessional: Boolean(
      input.state.draft.professional &&
      input.state.draft.professional !== ANY_PROFESSIONAL_ID
    )
  })
  const stateWithResolution: BookingV2State = {
    ...input.state,
    pendingAvailabilityResolution: pendingAvailabilityResolution({
      resolution,
      serviceIds: combinedServiceIds(input.state),
      professionalId: input.state.draft.professional,
      requestedDate: input.state.draft.date,
      requestedTime: input.state.draft.time
    })
  }
  return {
    resolution,
    plan,
    state: {
      ...applyBookingAvailabilityTransition(stateWithResolution, plan.transition),
      pendingDeposit: null
    }
  }
}

export function parsePendingAvailabilityResolution(
  value: unknown
): BookingV2PendingAvailabilityResolution | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BookingV2PendingAvailabilityResolution>
  if (!PENDING_AVAILABILITY_STATUSES.includes(candidate.status as BookingV2PendingAvailabilityResolution['status'])) {
    return null
  }
  if (!['PRESERVE_SELECTION', 'CLEAR_TIME', 'CLEAR_DATE_AND_TIME'].includes(candidate.transition ?? '')) {
    return null
  }
  if (!Array.isArray(candidate.actions) || !Array.isArray(candidate.serviceIds)) return null
  const actions = Array.from(new Set(candidate.actions.filter(
    (action): action is BookingAvailabilityAction => AVAILABILITY_ACTIONS.includes(action)
  )))
  const serviceIds = Array.from(new Set(candidate.serviceIds.filter(
    (serviceId): serviceId is string => typeof serviceId === 'string' && Boolean(serviceId.trim())
  ).map((serviceId) => serviceId.trim()))).slice(0, 5)
  if (!serviceIds.length || !actions.length) return null
  const options = Array.isArray(candidate.options)
    ? candidate.options.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const option = item as Record<string, unknown>
        if (
          typeof option.date !== 'string' ||
          typeof option.time !== 'string' ||
          typeof option.professionalId !== 'string' ||
          typeof option.professionalName !== 'string'
        ) return []
        return [{
          date: option.date,
          time: option.time,
          professionalId: option.professionalId,
          professionalName: option.professionalName
        }]
      }).slice(0, 15)
    : []
  return {
    status: candidate.status as BookingV2PendingAvailabilityResolution['status'],
    transition: candidate.transition as BookingAvailabilityTransition,
    actions,
    serviceIds,
    professionalId: nullableString(candidate.professionalId),
    requestedDate: nullableString(candidate.requestedDate),
    requestedTime: nullableString(candidate.requestedTime),
    options
  }
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isOccupiedConfirmationConflict(statusCode: number, message: string) {
  if (statusCode !== 409) return false
  const normalized = normalizeText(message)
  return normalized.includes('horario') &&
    (normalized.includes('no esta disponible') || normalized.includes('ocupado'))
}
