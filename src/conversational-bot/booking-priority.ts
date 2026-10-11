import { bookingOrderPriority } from '../services/booking-service-order.js'

/** Schedule order is independent of catalogue display order; ties keep the customer's order. */
export function orderServiceIdsByBookingPriority(
  ids: readonly string[],
  services: readonly { id: string; bookingOrderPriority?: number | null }[]
): string[] {
  const priorities = new Map(services.map(service => [service.id, bookingOrderPriority(service.bookingOrderPriority)]))
  return ids.map((id, index) => ({ id, index })).sort((left, right) =>
    (priorities.get(left.id) ?? bookingOrderPriority(undefined)) -
    (priorities.get(right.id) ?? bookingOrderPriority(undefined)) || left.index - right.index
  ).map(item => item.id)
}

export function hasBookingPriorityOrder(ids: readonly string[], services: readonly { id: string; bookingOrderPriority?: number | null }[]): boolean {
  const ordered = orderServiceIdsByBookingPriority(ids, services)
  return ids.every((id, index) => ordered[index] === id)
}
