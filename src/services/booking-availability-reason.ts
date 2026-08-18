export type BookingAvailabilityUnavailableCode =
  | 'BUSINESS_CLOSED'
  | 'PROFESSIONAL_NOT_WORKING'
  | 'NO_SLOTS'

export type BookingAvailabilityUnavailableReason = {
  code: BookingAvailabilityUnavailableCode
  message: string
}

export function bookingAvailabilityUnavailableReason(
  code: BookingAvailabilityUnavailableCode,
  professionalName?: string | null
): BookingAvailabilityUnavailableReason {
  if (code === 'BUSINESS_CLOSED') {
    return {
      code,
      message: 'El negocio está cerrado ese día.'
    }
  }
  if (code === 'PROFESSIONAL_NOT_WORKING') {
    return {
      code,
      message: professionalName
        ? `${professionalName} no trabaja ese día.`
        : 'El profesional no trabaja ese día.'
    }
  }
  return {
    code,
    message: 'No quedan turnos disponibles para ese día.'
  }
}

export function aggregateBookingAvailabilityUnavailableReason(
  reasons: Array<BookingAvailabilityUnavailableReason | null | undefined>,
  hasRequiredProfessional: boolean
): BookingAvailabilityUnavailableReason | null {
  const availableReasons = reasons.filter(
    (reason): reason is BookingAvailabilityUnavailableReason => Boolean(reason)
  )
  if (!availableReasons.length) return null
  if (availableReasons.every((reason) => reason.code === 'BUSINESS_CLOSED')) {
    return bookingAvailabilityUnavailableReason('BUSINESS_CLOSED')
  }
  if (
    hasRequiredProfessional &&
    availableReasons.every((reason) => reason.code === 'PROFESSIONAL_NOT_WORKING')
  ) {
    return availableReasons[0]!
  }
  return bookingAvailabilityUnavailableReason('NO_SLOTS')
}

export function classifyBookingAvailabilityUnavailable(input: {
  businessHasHours: boolean
  professionalHasHours: boolean
  hasOverlappingWindow: boolean
  businessFullDayBlocked: boolean
  professionalFullDayBlocked: boolean
  professionalName?: string | null
}) {
  if (!input.businessHasHours || input.businessFullDayBlocked) {
    return bookingAvailabilityUnavailableReason('BUSINESS_CLOSED')
  }
  if (
    !input.professionalHasHours ||
    !input.hasOverlappingWindow ||
    input.professionalFullDayBlocked
  ) {
    return bookingAvailabilityUnavailableReason(
      'PROFESSIONAL_NOT_WORKING',
      input.professionalName
    )
  }
  return bookingAvailabilityUnavailableReason('NO_SLOTS')
}
