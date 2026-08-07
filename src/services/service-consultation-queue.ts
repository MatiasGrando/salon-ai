export type ServiceConsultationMode = 'quote' | 'price'

export type ServiceConsultationEstimate = {
  serviceId: string
  priceMin: number
  priceMax: number | null
}

export type ServiceConsultationQueue = {
  mode?: ServiceConsultationMode
  remainingServiceIds: string[]
  estimates: ServiceConsultationEstimate[]
}

export function createServiceConsultationQueue(
  mode: ServiceConsultationMode,
  remainingServiceIds: string[] = []
): ServiceConsultationQueue {
  return {
    mode,
    remainingServiceIds: Array.from(new Set(remainingServiceIds)),
    estimates: []
  }
}

export function isPriceServiceConsultation(queue: ServiceConsultationQueue | null | undefined) {
  return queue?.mode === 'price'
}

export function queueRemainingServices(
  queue: ServiceConsultationQueue,
  serviceIds: string[],
  primaryServiceId: string | null
): ServiceConsultationQueue {
  return {
    ...queue,
    remainingServiceIds: Array.from(new Set([
      ...queue.remainingServiceIds,
      ...serviceIds
    ])).filter((serviceId) => serviceId !== primaryServiceId)
  }
}

export function restartServiceConsultationQueue(
  queue: ServiceConsultationQueue
): ServiceConsultationQueue {
  return {
    ...queue,
    remainingServiceIds: [],
    estimates: []
  }
}
