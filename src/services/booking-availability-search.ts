import {
  aggregateBookingAvailabilityUnavailableReason,
  type BookingAvailabilityUnavailableReason
} from './booking-availability-reason.js'

export type BookingAvailabilitySearchMode =
  | { type: 'DATE'; date: string; requestedTime?: string | null }
  | {
      type: 'NEXT_DAYS'
      afterDate: string
      horizonDays?: number
      maxDates?: number
    }
  | {
      type: 'TIME_ACROSS_DAYS'
      afterDate: string
      time: string
      horizonDays?: number
      maxDates?: number
    }

export type BookingAvailabilitySearchService = {
  id: string
  name: string
  durationMinutes: number
  customerDurationMinutes: number
  professionalIds: string[]
}

export type BookingAvailabilitySearchProfessional = {
  id: string
  name: string
}

export type BookingAvailabilitySearchSegment = {
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  startTime: string
  endTime: string
}

export type BookingAvailabilitySearchOption = {
  id: string
  date: string
  startTime: string
  endTime: string
  preferredProfessionalRespected: boolean
  segments: BookingAvailabilitySearchSegment[]
}

export type BookingAvailabilitySearchStatus =
  | 'AVAILABLE'
  | 'NEXT_DATES_FOUND'
  | 'REQUESTED_TIME_UNAVAILABLE'
  | 'NO_COMPATIBLE_PROFESSIONAL'
  | 'NO_AVAILABILITY_ON_DATE'
  | 'NO_CONTINUOUS_COMBINATION'
  | 'NO_UPCOMING_AVAILABILITY'
  | 'PROVIDER_ERROR'

export type BookingAvailabilitySearchResult = {
  status: BookingAvailabilitySearchStatus
  options: BookingAvailabilitySearchOption[]
  searchedDates: string[]
  requestedTime: string | null
  individualAvailabilityFound: boolean
  errors: Array<{ professionalId: string; serviceIds: string[]; message: string }>
  unavailable?: BookingAvailabilityUnavailableReason | null | undefined
}

export type BookingAvailabilitySlotLoader = (input: {
  date: string
  professionalId: string
  serviceIds: string[]
}) => Promise<
  | {
      ok: true
      slots: string[]
      unavailable?: BookingAvailabilityUnavailableReason | null | undefined
    }
  | { ok: false; message: string }
>

export type BookingAvailabilitySearchInput = {
  mode: BookingAvailabilitySearchMode
  services: BookingAvailabilitySearchService[]
  professionals: BookingAvailabilitySearchProfessional[]
  assignmentMode: 'SINGLE_PROFESSIONAL' | 'MULTIPLE_PROFESSIONALS'
  requiredProfessionalId?: string | null
  preferredProfessionalId?: string | null
  maxResults?: number
}

type LoadedSlot = {
  time: string
  professionalId: string
  professionalName: string
}

export class BookingAvailabilitySearchEngine {
  constructor(private readonly loadSlots: BookingAvailabilitySlotLoader) {}

  async search(input: BookingAvailabilitySearchInput): Promise<BookingAvailabilitySearchResult> {
    if (input.mode.type === 'DATE') {
      return this.searchDate(input, input.mode.date, input.mode.requestedTime ?? null)
    }

    const horizonDays = boundedInteger(input.mode.horizonDays, 14, 1, 30)
    const maxDates = boundedInteger(input.mode.maxDates, 3, 1, 5)
    const options: BookingAvailabilitySearchOption[] = []
    const searchedDates: string[] = []
    const errors: BookingAvailabilitySearchResult['errors'] = []
    let datesWithOptions = 0
    let individualAvailabilityFound = false
    let alternativeAvailabilityFound = false
    let providerErrorDates = 0

    for (let offset = 1; offset <= horizonDays && datesWithOptions < maxDates; offset += 1) {
      const date = addIsoDays(input.mode.afterDate, offset)
      if (!date) break
      const result = await this.searchDate(
        input,
        date,
        input.mode.type === 'TIME_ACROSS_DAYS' ? input.mode.time : null
      )
      searchedDates.push(date)
      errors.push(...result.errors)
      individualAvailabilityFound ||= result.individualAvailabilityFound
      alternativeAvailabilityFound ||= result.status === 'REQUESTED_TIME_UNAVAILABLE'
      if (result.status === 'PROVIDER_ERROR') providerErrorDates += 1
      if (result.status !== 'AVAILABLE') continue
      datesWithOptions += 1
      options.push(...result.options)
    }

    const limitedOptions = limitFutureOptionsFairly(
      options,
      boundedInteger(input.maxResults, 15, 1, 25)
    )
    if (limitedOptions.length) {
      return {
        status: 'NEXT_DATES_FOUND',
        options: limitedOptions,
        searchedDates,
        requestedTime: input.mode.type === 'TIME_ACROSS_DAYS' ? input.mode.time : null,
        individualAvailabilityFound,
        errors
      }
    }

    if (searchedDates.length && providerErrorDates === searchedDates.length) {
      return emptyResult('PROVIDER_ERROR', searchedDates, input.mode.type === 'TIME_ACROSS_DAYS'
        ? input.mode.time
        : null, individualAvailabilityFound, errors)
    }
    if (input.mode.type === 'TIME_ACROSS_DAYS' && alternativeAvailabilityFound) {
      return emptyResult(
        'REQUESTED_TIME_UNAVAILABLE',
        searchedDates,
        input.mode.time,
        individualAvailabilityFound,
        errors
      )
    }
    return emptyResult(
      individualAvailabilityFound ? 'NO_CONTINUOUS_COMBINATION' : 'NO_UPCOMING_AVAILABILITY',
      searchedDates,
      input.mode.type === 'TIME_ACROSS_DAYS' ? input.mode.time : null,
      individualAvailabilityFound,
      errors
    )
  }

  private async searchDate(
    input: BookingAvailabilitySearchInput,
    date: string,
    requestedTime: string | null
  ): Promise<BookingAvailabilitySearchResult> {
    const searchedDates = [date]
    if (!input.services.length) {
      return emptyResult('NO_COMPATIBLE_PROFESSIONAL', searchedDates, requestedTime)
    }
    const professionalNames = new Map(input.professionals.map((professional) => [
      professional.id,
      professional.name
    ]))
    const requiredProfessionalId = input.requiredProfessionalId ?? null
    const effectivePreferredProfessionalId = input.preferredProfessionalId ?? requiredProfessionalId
    const candidates = input.services.map((service) => ({
      service,
      professionalIds: service.professionalIds.filter((professionalId) =>
        professionalNames.has(professionalId) &&
        (input.assignmentMode === 'MULTIPLE_PROFESSIONALS' || !requiredProfessionalId || professionalId === requiredProfessionalId)
      )
    }))
    if (
      requiredProfessionalId &&
      input.assignmentMode === 'MULTIPLE_PROFESSIONALS' &&
      !candidates.some((candidate) => candidate.professionalIds.includes(requiredProfessionalId))
    ) {
      return emptyResult('NO_COMPATIBLE_PROFESSIONAL', searchedDates, requestedTime)
    }
    if (candidates.some((candidate) => candidate.professionalIds.length === 0)) {
      return emptyResult('NO_COMPATIBLE_PROFESSIONAL', searchedDates, requestedTime)
    }

    const loaded = input.assignmentMode === 'SINGLE_PROFESSIONAL'
      ? await this.loadSingleProfessionalOptions({
          date,
          services: input.services,
          candidates,
          professionalNames,
          preferredProfessionalId: effectivePreferredProfessionalId,
          requestedTime,
          hasRequiredProfessional: Boolean(requiredProfessionalId)
        })
      : await this.loadMultipleProfessionalOptions({
          date,
          candidates,
          professionalNames,
          preferredProfessionalId: effectivePreferredProfessionalId,
          requestedTime
        })

    const requiredOptions = requiredProfessionalId && input.assignmentMode === 'MULTIPLE_PROFESSIONALS'
      ? loaded.options.filter((option) => option.segments.some((segment) =>
          segment.professionalId === requiredProfessionalId
        ))
      : loaded.options
    const ranked = rankOptions(requiredOptions, effectivePreferredProfessionalId)
    const maxResults = boundedInteger(input.maxResults, 15, 1, 25)
    if (!loaded.compatibleAssignmentFound) {
      return emptyResult('NO_COMPATIBLE_PROFESSIONAL', searchedDates, requestedTime)
    }
    if (requestedTime) {
      const exact = ranked.filter((option) => option.startTime === requestedTime).slice(0, maxResults)
      if (exact.length) {
        return result('AVAILABLE', exact, searchedDates, requestedTime, loaded.individualAvailabilityFound, loaded.errors)
      }
      if (ranked.length) {
        return result(
          'REQUESTED_TIME_UNAVAILABLE',
          nearestOptionsToRequestedTime(ranked, requestedTime).slice(0, maxResults),
          searchedDates,
          requestedTime,
          loaded.individualAvailabilityFound,
          loaded.errors
        )
      }
    } else if (ranked.length) {
      return result('AVAILABLE', ranked.slice(0, maxResults), searchedDates, null, loaded.individualAvailabilityFound, loaded.errors)
    }

    if (loaded.providerUnavailable) {
      return emptyResult('PROVIDER_ERROR', searchedDates, requestedTime, loaded.individualAvailabilityFound, loaded.errors)
    }
    return emptyResult(
      loaded.individualAvailabilityFound
        ? 'NO_CONTINUOUS_COMBINATION'
        : 'NO_AVAILABILITY_ON_DATE',
      searchedDates,
      requestedTime,
      loaded.individualAvailabilityFound,
      loaded.errors,
      loaded.unavailable
    )
  }

  private async loadSingleProfessionalOptions(input: {
    date: string
    services: BookingAvailabilitySearchService[]
    candidates: Array<{ service: BookingAvailabilitySearchService; professionalIds: string[] }>
    professionalNames: Map<string, string>
    preferredProfessionalId: string | null
    requestedTime: string | null
    hasRequiredProfessional: boolean
  }) {
    const commonProfessionalIds = input.candidates[0]?.professionalIds.filter((professionalId) =>
      input.candidates.every((candidate) => candidate.professionalIds.includes(professionalId))
    ) ?? []
    const calls = await Promise.all(commonProfessionalIds.map(async (professionalId) => ({
      professionalId,
      response: await this.loadSlots({
        date: input.date,
        professionalId,
        serviceIds: input.services.map((service) => service.id)
      })
    })))
    const errors = calls.flatMap((call) => call.response.ok
      ? []
      : [{
          professionalId: call.professionalId,
          serviceIds: input.services.map((service) => service.id),
          message: call.response.message
        }])
    const options = calls.flatMap((call) => call.response.ok
      ? call.response.slots.flatMap((time) => {
          const segments = buildSegmentsForSingleProfessional({
            services: input.services,
            professionalId: call.professionalId,
            professionalName: input.professionalNames.get(call.professionalId) ?? call.professionalId,
            startTime: time
          })
          return segments ? [buildOption(input.date, segments, input.preferredProfessionalId)] : []
        })
      : [])
    return {
      options,
      errors,
      unavailable: aggregateBookingAvailabilityUnavailableReason(
        calls.flatMap((call) => call.response.ok ? [call.response.unavailable] : []),
        input.hasRequiredProfessional
      ),
      individualAvailabilityFound: options.length > 0,
      providerUnavailable: commonProfessionalIds.length > 0 && calls.every((call) => !call.response.ok),
      compatibleAssignmentFound: commonProfessionalIds.length > 0
    }
  }

  private async loadMultipleProfessionalOptions(input: {
    date: string
    candidates: Array<{ service: BookingAvailabilitySearchService; professionalIds: string[] }>
    professionalNames: Map<string, string>
    preferredProfessionalId: string | null
    requestedTime: string | null
  }) {
    const loadedByService = await Promise.all(input.candidates.map(async (candidate) => {
      const calls = await Promise.all(candidate.professionalIds.map(async (professionalId) => ({
        professionalId,
        response: await this.loadSlots({
          date: input.date,
          professionalId,
          serviceIds: [candidate.service.id]
        })
      })))
      const slots: LoadedSlot[] = calls.flatMap((call) => call.response.ok
        ? call.response.slots.map((time) => ({
            time,
            professionalId: call.professionalId,
            professionalName: input.professionalNames.get(call.professionalId) ?? call.professionalId
          }))
        : [])
      slots.sort((left, right) =>
        Number(right.time === input.requestedTime) - Number(left.time === input.requestedTime) ||
        Number(right.professionalId === input.preferredProfessionalId) -
          Number(left.professionalId === input.preferredProfessionalId) ||
        left.time.localeCompare(right.time) ||
        left.professionalName.localeCompare(right.professionalName)
      )
      return { candidate, calls, slots }
    }))
    const errors = loadedByService.flatMap(({ candidate, calls }) => calls.flatMap((call) =>
      call.response.ok
        ? []
        : [{
            professionalId: call.professionalId,
            serviceIds: [candidate.service.id],
            message: call.response.message
          }]
    ))
    const providerUnavailable = loadedByService.some(({ calls }) =>
      calls.length > 0 && calls.every((call) => !call.response.ok)
    )
    const individualAvailabilityFound = loadedByService.every(({ slots }) => slots.length > 0)
    if (!individualAvailabilityFound) {
      return {
        options: [],
        errors,
        unavailable: aggregateBookingAvailabilityUnavailableReason(
          loadedByService.flatMap(({ calls }) => calls.flatMap((call) =>
            call.response.ok ? [call.response.unavailable] : []
          )),
          false
        ),
        individualAvailabilityFound,
        providerUnavailable,
        compatibleAssignmentFound: true
      }
    }

    let partials: BookingAvailabilitySearchSegment[][] = [[]]
    for (const { candidate, slots } of loadedByService) {
      const nextPartials: BookingAvailabilitySearchSegment[][] = []
      for (const partial of partials) {
        const requiredStart = partial.length ? partial[partial.length - 1]?.endTime ?? null : null
        for (const slot of slots) {
          if (requiredStart && slot.time !== requiredStart) continue
          const endTime = addMinutesToTime(slot.time, candidate.service.customerDurationMinutes)
          if (!endTime) continue
          nextPartials.push([...partial, {
            serviceId: candidate.service.id,
            serviceName: candidate.service.name,
            professionalId: slot.professionalId,
            professionalName: slot.professionalName,
            startTime: slot.time,
            endTime
          }])
          if (nextPartials.length >= 100) break
        }
        if (nextPartials.length >= 100) break
      }
      partials = nextPartials
      if (!partials.length) break
    }
    return {
      options: partials.map((segments) => buildOption(input.date, segments, input.preferredProfessionalId)),
      errors,
      unavailable: null,
      individualAvailabilityFound,
      providerUnavailable,
      compatibleAssignmentFound: true
    }
  }
}

export function parseBookingAvailabilitySearchOption(
  value: unknown
): BookingAvailabilitySearchOption | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BookingAvailabilitySearchOption>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.date !== 'string' ||
    typeof candidate.startTime !== 'string' ||
    typeof candidate.endTime !== 'string' ||
    typeof candidate.preferredProfessionalRespected !== 'boolean' ||
    !Array.isArray(candidate.segments)
  ) return null
  const segments = candidate.segments.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const segment = value as Partial<BookingAvailabilitySearchSegment>
    if (
      typeof segment.serviceId !== 'string' ||
      typeof segment.serviceName !== 'string' ||
      typeof segment.professionalId !== 'string' ||
      typeof segment.professionalName !== 'string' ||
      typeof segment.startTime !== 'string' ||
      typeof segment.endTime !== 'string'
    ) return []
    return [{
      serviceId: segment.serviceId,
      serviceName: segment.serviceName,
      professionalId: segment.professionalId,
      professionalName: segment.professionalName,
      startTime: segment.startTime,
      endTime: segment.endTime
    }]
  })
  if (!segments.length || segments.length !== candidate.segments.length) return null
  return {
    id: candidate.id,
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    preferredProfessionalRespected: candidate.preferredProfessionalRespected,
    segments
  }
}

function buildSegmentsForSingleProfessional(input: {
  services: BookingAvailabilitySearchService[]
  professionalId: string
  professionalName: string
  startTime: string
}) {
  const segments: BookingAvailabilitySearchSegment[] = []
  let startTime = input.startTime
  for (const service of input.services) {
    const endTime = addMinutesToTime(startTime, service.customerDurationMinutes)
    if (!endTime) return null
    segments.push({
      serviceId: service.id,
      serviceName: service.name,
      professionalId: input.professionalId,
      professionalName: input.professionalName,
      startTime,
      endTime
    })
    startTime = endTime
  }
  return segments
}

function buildOption(
  date: string,
  segments: BookingAvailabilitySearchSegment[],
  preferredProfessionalId: string | null
): BookingAvailabilitySearchOption {
  const startTime = segments[0]?.startTime ?? ''
  const endTime = segments[segments.length - 1]?.endTime ?? ''
  const preferredProfessionalRespected = Boolean(
    preferredProfessionalId &&
    segments.some((segment) => segment.professionalId === preferredProfessionalId)
  )
  return {
    id: [date, ...segments.map((segment) =>
      `${segment.serviceId}:${segment.professionalId}:${segment.startTime}`
    )].join('|'),
    date,
    startTime,
    endTime,
    preferredProfessionalRespected,
    segments
  }
}

function rankOptions(
  options: BookingAvailabilitySearchOption[],
  preferredProfessionalId: string | null
) {
  const ranked = Array.from(new Map(options.map((option) => [option.id, option])).values()).sort((left, right) => {
    if (preferredProfessionalId) {
      const preferenceDifference = Number(right.preferredProfessionalRespected) -
        Number(left.preferredProfessionalRespected)
      if (preferenceDifference) return preferenceDifference
    }
    return left.date.localeCompare(right.date) ||
      left.startTime.localeCompare(right.startTime) ||
      left.id.localeCompare(right.id)
  })
  const seenBlocks = new Set<string>()
  return ranked.filter((option) => {
    const block = `${option.date}|${option.startTime}|${option.endTime}`
    if (seenBlocks.has(block)) return false
    seenBlocks.add(block)
    return true
  })
}

function nearestOptionsToRequestedTime(
  options: BookingAvailabilitySearchOption[],
  requestedTime: string
) {
  const requestedMinutes = timeInMinutes(requestedTime)
  if (requestedMinutes === null) return options

  return [...options].sort((left, right) => {
    const leftMinutes = timeInMinutes(left.startTime)
    const rightMinutes = timeInMinutes(right.startTime)
    const leftDistance = leftMinutes === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(leftMinutes - requestedMinutes)
    const rightDistance = rightMinutes === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(rightMinutes - requestedMinutes)
    if (leftDistance !== rightDistance) return leftDistance - rightDistance

    // Ante la misma cercanía, es preferible sugerir un horario posterior al pedido.
    return (rightMinutes ?? 0) - (leftMinutes ?? 0) || left.id.localeCompare(right.id)
  })
}

function timeInMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function result(
  status: BookingAvailabilitySearchStatus,
  options: BookingAvailabilitySearchOption[],
  searchedDates: string[],
  requestedTime: string | null,
  individualAvailabilityFound: boolean,
  errors: BookingAvailabilitySearchResult['errors'],
  unavailable: BookingAvailabilityUnavailableReason | null = null
): BookingAvailabilitySearchResult {
  return { status, options, searchedDates, requestedTime, individualAvailabilityFound, errors, unavailable }
}

function limitFutureOptionsFairly(
  options: BookingAvailabilitySearchOption[],
  maxResults: number
) {
  const firstByDate = Array.from(new Map(
    options.map((option) => [option.date, option])
  ).values()).slice(0, maxResults)
  if (firstByDate.length >= maxResults) return firstByDate
  const selectedIds = new Set(firstByDate.map((option) => option.id))
  return [
    ...firstByDate,
    ...options.filter((option) => !selectedIds.has(option.id))
  ].slice(0, maxResults)
}

function emptyResult(
  status: BookingAvailabilitySearchStatus,
  searchedDates: string[],
  requestedTime: string | null,
  individualAvailabilityFound = false,
  errors: BookingAvailabilitySearchResult['errors'] = [],
  unavailable: BookingAvailabilityUnavailableReason | null = null
) {
  return result(status, [], searchedDates, requestedTime, individualAvailabilityFound, errors, unavailable)
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isInteger(value) ? Number(value) : fallback
  return Math.max(min, Math.min(parsed, max))
}

function addMinutesToTime(time: string, minutes: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59 || minutes <= 0) return null
  const total = hour * 60 + minute + minutes
  if (total > 24 * 60) return null
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function addIsoDays(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
