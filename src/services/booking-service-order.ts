import type { BookingV2DomainCatalog } from './booking-v2-domain.js'
import type { BookingV2CombinedService, BookingV2State } from './booking-v2-state.js'

export const DEFAULT_BOOKING_ORDER_PRIORITY = 20

export function bookingOrderPriority(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : DEFAULT_BOOKING_ORDER_PRIORITY
}

export function orderBookingServicesByPriority(
  state: BookingV2State,
  catalog: Pick<BookingV2DomainCatalog, 'services'>
): BookingV2State {
  if (!state.draft.service || state.combinedServices.length === 0) return state

  const original = [
    { serviceId: state.draft.service, evidence: '' },
    ...state.combinedServices
  ].filter((service, index, services) =>
    services.findIndex((candidate) => candidate.serviceId === service.serviceId) === index
  )
  const priorityByServiceId = new Map(
    catalog.services.map((service) => [
      service.id,
      bookingOrderPriority(service.bookingOrderPriority)
    ])
  )
  const ordered = original
    .map((service, originalIndex) => ({ service, originalIndex }))
    .sort((left, right) => {
      const priorityDifference =
        (priorityByServiceId.get(left.service.serviceId) ?? DEFAULT_BOOKING_ORDER_PRIORITY) -
        (priorityByServiceId.get(right.service.serviceId) ?? DEFAULT_BOOKING_ORDER_PRIORITY)
      return priorityDifference || left.originalIndex - right.originalIndex
    })
    .map(({ service }) => service)

  if (ordered.every((service, index) => service.serviceId === original[index]?.serviceId)) {
    return state
  }

  const [primary, ...additional] = ordered
  return {
    ...state,
    draft: {
      ...state.draft,
      service: primary?.serviceId ?? state.draft.service
    },
    combinedServices: additional as BookingV2CombinedService[]
  }
}
